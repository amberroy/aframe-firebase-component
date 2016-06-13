require('firebase');
var parse = require('url-parse');

if (typeof AFRAME === 'undefined') {
  throw new Error('Component attempted to register before AFRAME was available.');
}

/**
 * Firebase system.
 */
AFRAME.registerSystem('firebase', {
  init: function () {
    var sceneEl = this.sceneEl;
    var config = sceneEl.getAttribute('firebase');
    var self = this;

    if (!(config instanceof Object)) {
      config = AFRAME.utils.styleParser.parse(config);
    }

    if (!config) { return; }

    this.channel = 'default';
    if (config.channel) {
      this.channel = config.channel;
    }
    var url = parse(location.href, true);
    if (url.query && url.query['aframe-firebase-channel']) {
      this.channel = url.query['aframe-firebase-channel'];
    }

    this.firebase = firebase.initializeApp(config);
    this.database = firebase.database().ref(this.channel);

    this.broadcastingEntities = {};
    this.entities = {};

    var database = this.database;
    database.child('entities').once('value', function (snapshot) {
      self.handleInitialSync(snapshot.val());
    });

    database.child('entities').on('child_added', function (data) {
      self.handleEntityAdded(data.key, data.val());
    });

    database.child('entities').on('child_changed', function (data) {
      self.handleEntityChanged(data.key, data.val());
    });

    database.child('entities').on('child_removed', function (data) {
      self.handleEntityRemoved(data.key);
    });
  },

  /**
   * Initial sync.
   */
  handleInitialSync: function (data) {
    var self = this;
    var broadcastingEntities = this.broadcastingEntities;
    Object.keys(data).forEach(function (entityId) {
      if (broadcastingEntities[entityId]) { return; }
      self.handleEntityAdded(entityId, data[entityId]);
    });
  },

  /**
   * Entity added.
   */
  handleEntityAdded: function (id, data) {
    // Already added.
    if (this.entities[id] || this.broadcastingEntities[id]) { return; }

    var entity = document.createElement('a-entity');
    this.entities[id] = entity;

    // Parent node.
    var parentId = data.parentId;
    var parentEl = this.entities[parentId] || this.sceneEl;
    delete data.parentId;

    // Components.
    Object.keys(data).forEach(function setComponent (componentName) {
      if (componentName === 'parentId') { return; }
      entity.setAttribute(componentName, data[componentName]);
    });

    parentEl.appendChild(entity);
  },

  /**
   * Entity updated.
   */
  handleEntityChanged: function (id, components) {
    // Don't sync if already broadcasting to self-updating loops.
    if (this.broadcastingEntities[id]) { return; }

    var entity = this.entities[id];
    Object.keys(components).forEach(function setComponent (componentName) {
      if (componentName === 'parentId') { return; }
      entity.setAttribute(componentName, components[componentName]);
    });
  },

  /**
   * Entity removed. Detach.
   */
  handleEntityRemoved: function (id) {
    var entity = this.entities[id];
    if (!entity) { return; }
    entity.parentNode.removeChild(entity);
    delete this.entities[id];
  },

  /**
   * Delete all broadcasting entities.
   * (currently unused, handled by Firebase onDisconnect)
   */
  handleExit: function () {
    var self = this;
    Object.keys(this.broadcastingEntities).forEach(function (id) {
      delete self.broadcastingEntities[id];
      this.database.child('entities/' + id).remove();
    });
  },

  /**
   * Register.
   */
  registerBroadcast: function (el, components, interval) {
    var broadcastingEntities = this.broadcastingEntities;
    var database = this.database;
    // Initialize entry.
    var id = database.child('entities').push().key;
    el.setAttribute('firebase-broadcast', 'id', id);
    broadcastingEntities[id] = el;
    // Remove entry when this clients disconnects. 
    database.child('entities').child(id).onDisconnect().remove();
  },

  /**
   * Broadcast.
   */
  tick: function (time) {
    if (!this.firebase) { return; }

    var broadcastingEntities = this.broadcastingEntities;
    var database = this.database;
    var sceneEl = this.sceneEl;

    if (time - this.time < 10) { return; }
    this.time = time;

    Object.keys(broadcastingEntities).forEach(function broadcast (id) {
      var el = broadcastingEntities[id];
      var components = el.getAttribute('firebase-broadcast').components;
      var data = {};

      // Parent.
      if (el.parentNode !== sceneEl) {
        var broadcastData = el.parentNode.getAttribute('firebase-broadcast');
        if (!broadcastData) { return; }  // Wait for parent to initialize.
        data.parentId = broadcastData.id;
      }

      // Build data.
      components.forEach(function getData (componentName) {
        data[componentName] = el.getComputedAttribute(componentName);
      });

      // Update entry.
      database.child('entities/' + id).update(data);
    });
  }
});

/**
 * Data holder for the scene.
 */
AFRAME.registerComponent('firebase', {
  schema: {
    apiKey: {type: 'string'},
    authDomain: {type: 'string'},
    databaseURL: {type: 'string'},
    storageBucket: {type: 'string'},
    channel: {type: 'string'}
  }
});

/**
 * Broadcast.
 */
AFRAME.registerComponent('firebase-broadcast', {
  schema: {
    id: {default: ''},
    components: {default: ['position', 'rotation']}
  },

  init: function () {
    var el = this.el;
    var system = el.sceneEl.systems.firebase;
    if (this.data.components.length) {
      system.registerBroadcast(el, this.data.components);
    }
  }
});
