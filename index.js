require('firebase');
var parse = require('url-parse');

if (typeof AFRAME === 'undefined') {
  throw new Error('Component attempted to register before AFRAME was available.');
}

var channelQueryParam = parse(location.href, true).query['aframe-firebase-channel'];

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

    this.channel = channelQueryParam || config.channel || 'default';
    this.firebase = firebase.initializeApp(config);
    var database = this.database = firebase.database().ref(this.channel);

    this.broadcastingEntities = {};
    this.entities = {};

    database.child('entities').once('value', function (snapshot) {
      self.handleInitialSync(snapshot.val() || {});
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
      setAttribute(entity, componentName, data[componentName]);
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
      setAttribute(entity, componentName, components[componentName]);
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
      self.database.child('entities/' + id).remove();
    });
  },

  /**
   * Register.
   */
  registerBroadcast: function (el) {
    var broadcastingEntities = this.broadcastingEntities;
    var database = this.database;

    // Initialize entry, get assigned a Firebase ID.
    var id = database.child('entities').push().key;
    el.setAttribute('firebase-broadcast', 'id', id);
    broadcastingEntities[id] = el;

    // Remove entry when client disconnects.
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

      // Add components to broadcast once.
      if (!el.firebaseBroadcastOnce && el.getAttribute('firebase-broadcast').componentsOnce) {
        components = components.concat(el.getAttribute('firebase-broadcast').componentsOnce);
        el.firebaseBroadcastOnce = true;
      }

      // Parent.
      if (el.parentNode !== sceneEl) {
        var broadcastData = el.parentNode.getAttribute('firebase-broadcast');
        if (!broadcastData) { return; }  // Wait for parent to initialize.
        data.parentId = broadcastData.id;
      }

      // Build data.
      components.forEach(function getData (componentName) {
        data[componentName] = getComputedAttribute(el, componentName);
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
    components: {default: ['position', 'rotation']},
    componentsOnce: {default: [], type: 'array'}
  },

  init: function () {
    var data = this.data;
    var el = this.el;
    var system = el.sceneEl.systems.firebase;
    if (data.components.length) {
      system.registerBroadcast(el);
    }
  }
});

/**
 * Get attribute that handles individual component properties.
 */
function getComputedAttribute (el, attribute) {
  // Handle individual component property.
  var split = attribute.split('|');
  if (split.length === 2) {
    return el.getComputedAttribute(split[0])[split[1]];
  }
  return el.getComputedAttribute(attribute);
}

/**
 * Set attribute that handles individual component properties.
 */
function setAttribute (el, attribute, value) {
  // Handle individual component property.
  var split = attribute.split('|');
  if (split.length === 2) {
    el.setAttribute(split[0], split[1], value);
    return;
  }
  el.setAttribute(attribute, value);
}
