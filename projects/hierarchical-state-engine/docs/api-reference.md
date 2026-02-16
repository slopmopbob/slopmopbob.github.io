# API Reference

## Constructor

### `new SpawnEngine(config?)`

Create a new engine instance.

```javascript
const engine = new SpawnEngine();
engine.loadConfig(config);

// Or with config
const engine = new SpawnEngine(config);
```

---

## Configuration

### `loadConfig(config)`

Load a configuration object. Returns the engine for chaining.

```javascript
engine.loadConfig({
  id: 'my-config',
  name: 'My Configuration',
  nodes: [...],
  relationships: [...]
});
```

---

## Entity Management

### `spawn(overrides?)`

Create a new entity with random attributes and traits.

**Parameters:**
- `overrides.id` - Custom entity ID
- `overrides.attributes` - Fixed attribute values
- `overrides.contexts` - Context values
- `overrides.forceTraits` - Trait IDs to force-activate

**Returns:** Entity object

```javascript
// Random entity
const entity = engine.spawn();

// With overrides
const strong = engine.spawn({
  attributes: { attr_strength: 10 },
  forceTraits: ['item_warrior']
});
```

### `despawn(entityId)`

Remove an entity.

**Returns:** `true` if removed, `false` if not found

```javascript
engine.despawn(entity.id);
```

### `getEntity(entityId)`

Get an entity by ID.

**Returns:** Entity object or `null`

```javascript
const entity = engine.getEntity('entity_123');
```

### `getAllEntities()`

Get all spawned entities.

**Returns:** Array of entity objects

```javascript
const entities = engine.getAllEntities();
```

---

## Time & Variables

### `tick(entityOrId, deltaSeconds?)`

Advance time for an entity. Updates variables, expires modifiers.

**Parameters:**
- `entityOrId` - Entity object or ID
- `deltaSeconds` - Time delta (auto-calculated from last tick if omitted)

**Returns:** Updated entity or `null`

```javascript
engine.tick(entity, 1); // 1 second
engine.tick(entity.id); // Auto-calculate delta
```

### `tickAll(deltaSeconds?)`

Advance time for all entities.

```javascript
engine.tickAll(1); // Tick all entities 1 second
```

### `modifyVariable(entityOrId, varId, delta)`

Change a variable by a delta amount.

**Returns:** `true` if successful

```javascript
engine.modifyVariable(entity, 'var_hunger', -20); // Reduce hunger by 20
```

### `setVariable(entityOrId, varId, value)`

Set a variable to an absolute value.

**Returns:** `true` if successful

```javascript
engine.setVariable(entity, 'var_hunger', 100); // Full hunger
```

---

## Traits & Modifiers

### `activateTrait(entityOrId, traitId)`

Activate a trait for an entity.

**Returns:** `true` if activated

```javascript
engine.activateTrait(entity, 'item_grumpy');
```

### `deactivateTrait(entityOrId, traitId)`

Deactivate a trait.

**Returns:** `true` if deactivated

```javascript
engine.deactivateTrait(entity, 'item_cheerful');
```

### `rollLayer(entity, layerId)`

Roll a layer to select a new trait (weighted random).

**Returns:** `{ success: boolean, selected?: string[] }`

```javascript
const result = engine.rollLayer(entity, 'layer_mood');
if (result.success) {
  console.log('Selected:', result.selected);
}
```

### `applyModifier(entityOrId, modifierId)`

Apply a modifier to an entity.

**Returns:** `true` if applied

```javascript
engine.applyModifier(entity, 'mod_tipsy');
```

### `removeModifier(entityOrId, modifierId)`

Remove a modifier from an entity.

**Returns:** `true` if removed

```javascript
engine.removeModifier(entity, 'mod_tipsy');
```

---

## State Queries

### `getState(entityId)`

Get a summarized view of entity state.

**Returns:** State summary object

```javascript
const state = engine.getState(entity.id);
/*
{
  id: 'entity_123',
  createdAt: 1706500000000,
  attributes: { attr_patience: 7, attr_charm: 5 },
  variables: {
    var_hunger: { value: 65, min: 0, max: 100, currentRate: -4.5 }
  },
  activeTraits: [
    { id: 'item_optimist', name: 'Optimist', layerId: 'layer_personality' }
  ],
  activeModifiers: [
    { id: 'mod_tipsy', name: 'Tipsy', stacks: 2 }
  ],
  activeCompounds: [
    { id: 'comp_jolly_drunk', name: 'Jolly Drunk' }
  ],
  derived: { derived_tip_multiplier: 1.4 }
}
*/
```

### `getNode(nodeId)`

Get a node definition from the config.

**Returns:** Node object or `null`

```javascript
const node = engine.getNode('attr_patience');
// { id: 'attr_patience', name: 'Patience', type: 'attribute', config: {...} }
```

### `getNodesByType(type)`

Get all nodes of a specific type.

**Returns:** Array of nodes

```javascript
const attributes = engine.getNodesByType('attribute');
const modifiers = engine.getNodesByType('modifier');
```

### Convenience Methods

```javascript
engine.getAttributes();  // getNodesByType('attribute')
engine.getVariables();   // getNodesByType('variable')
engine.getModifiers();   // getNodesByType('modifier')
engine.getCompounds();   // getNodesByType('compound')
engine.getDerived();     // getNodesByType('derived')
engine.getLayers();      // getNodesByType('layer'), sorted by order
engine.getLayerTraits(layerId);  // Traits in a specific layer
```

### `getRelationshipsFrom(nodeId)`

Get relationships where the node is the source.

```javascript
const effects = engine.getRelationshipsFrom('attr_patience');
// What does Patience affect?
```

### `getRelationshipsTo(nodeId)`

Get relationships where the node is the target.

```javascript
const influences = engine.getRelationshipsTo('item_mellow');
// What affects Mellow's selection weight?
```

---

## Events

### `on(event, callback)`

Subscribe to an event.

**Returns:** Unsubscribe function

```javascript
const unsubscribe = engine.on('compoundActivated', (data) => {
  console.log(data.compoundId, 'activated for', data.entityId);
});

// Later
unsubscribe();
```

### `emit(event, data)`

Emit an event (primarily for internal use).

```javascript
engine.emit('customEvent', { foo: 'bar' });
```

### Available Events

| Event | Data |
|-------|------|
| `entitySpawned` | `{ entity }` |
| `entityDespawned` | `{ entityId }` |
| `variableChanged` | `{ entityId, varId, oldValue, newValue }` |
| `traitActivated` | `{ entityId, traitId }` |
| `traitDeactivated` | `{ entityId, traitId }` |
| `modifierApplied` | `{ entityId, modifierId }` |
| `modifierRemoved` | `{ entityId, modifierId }` |
| `compoundActivated` | `{ entityId, compoundId }` |
| `compoundDeactivated` | `{ entityId, compoundId }` |
| `tick` | `{ entityId, deltaSeconds }` |

---

## Entity Structure

Entities have this structure:

```javascript
{
  id: 'entity_1706500000_abc123',
  configId: 'tavern-patron',
  createdAt: 1706500000000,

  attributes: {
    attr_patience: 7,
    attr_charm: 5
  },

  variables: {
    var_hunger: {
      value: 65,
      baseRate: -5,
      currentRate: -4.5,  // Modified by active traits
      min: 0,
      max: 100,
      changeMode: 'timed',
      direction: 'deplete'
    }
  },

  contexts: {},

  layers: {
    layer_personality: {
      active: ['item_optimist', 'item_mellow'],
      lastRoll: 1706500000000
    }
  },

  modifiers: ['mod_tipsy'],

  compounds: ['comp_jolly_drunk'],

  derived: {
    derived_tip_multiplier: 1.4
  },

  _modifierStates: {
    mod_tipsy: {
      appliedAt: 1706500050000,
      stacks: 2,
      expiresAt: 1706500170000
    }
  },

  _internal: {
    lastTick: 1706500100000
  }
}
```
