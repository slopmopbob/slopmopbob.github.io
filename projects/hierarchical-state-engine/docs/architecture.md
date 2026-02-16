# Architecture

The Hierarchical State Engine uses a **layered cascade** architecture where each layer influences the next through relationships.

## Core Concept

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Attributes │ ──> │   Traits    │ ──> │  Variables  │ ──> │  Modifiers  │ ──> │  Compounds  │
│  (static)   │     │  (selected) │     │  (ticking)  │     │ (temporary) │     │ (emergent)  │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
      │                   │                   │                   │                   │
      └───────────────────┴───────────────────┴───────────────────┴───────────────────┘
                                    Relationships
```

### Flow

1. **Spawn** - Attributes are rolled, traits are selected from weighted pools
2. **Runtime** - Variables tick over time, modifiers apply/expire
3. **Cascade** - Active traits modify variable rates via relationships
4. **Emergence** - Compounds auto-activate when requirements are met

## Relationship Types

Relationships connect nodes and define how they influence each other:

### weight_influence

Changes the probability of selecting a trait.

```
Attribute: Patience = 8
     │
     │  weight_influence (perPoint: +3)
     ▼
Trait: Mellow (base weight: 20 → final: 44)
```

High patience makes "Mellow" trait 24 points more likely to be selected.

### rate_modifier

Changes how fast a variable ticks.

```
Trait: Optimist (active)
     │
     │  rate_modifier (multiply: 0.9)
     ▼
Variable: Hunger (rate: -5/sec → -4.5/sec)
```

Optimists get hungry 10% slower than normal.

### value_modifier

Directly adjusts a value when conditions are met.

```
Modifier: Well Fed (active)
     │
     │  value_modifier (add: +20)
     ▼
Derived: Tip Multiplier
```

## Layers

Traits are organized into layers, each with its own selection rules:

```json
{
  "id": "layer_personality",
  "type": "layer",
  "config": {
    "selection": {
      "mode": "weighted",    // Random weighted selection
      "maxItems": 3,         // Maximum traits from this layer
      "initialRolls": 2      // Roll twice at spawn
    }
  }
}
```

### Selection Modes

- **weighted** - Probability based on calculated weights
- **threshold** - Auto-activates when variable crosses threshold
- **allMatching** - All eligible traits activate
- **firstMatch** - First eligible trait activates

## Eligibility & Incompatibility

### Eligibility Conditions

Traits can require conditions to be considered:

```json
{
  "id": "item_elite_warrior",
  "config": {
    "eligibility": [
      { "type": "attribute", "target": "attr_strength", "operator": ">=", "value": 8 }
    ]
  }
}
```

### Incompatibility

Traits can exclude each other:

```json
{
  "id": "item_optimist",
  "config": {
    "incompatibleWith": ["item_pessimist"]
  }
}
```

## Compound States

Compounds are emergent - they activate automatically when all requirements are met:

```json
{
  "id": "comp_hangry",
  "type": "compound",
  "config": {
    "requires": [
      { "modifier": "mod_starving" },
      { "item": "item_grumpy" }
    ],
    "requirementLogic": "all"  // or "any"
  }
}
```

The engine checks compounds after any state change. No manual triggering needed.

## Event Flow

State changes emit events for game integration:

```
spawn() ──> "entitySpawned"
tick()  ──> "variableChanged" (per variable)
        ──> "modifierApplied" / "modifierRemoved"
        ──> "compoundActivated" / "compoundDeactivated"
```

Subscribe to events:

```javascript
engine.on('compoundActivated', ({ entityId, compoundId }) => {
    if (compoundId === 'comp_hangry') {
        showWarning('Customer is hangry!');
    }
});
```

## Derived Values

Formulas computed from current state:

```json
{
  "id": "derived_tip_multiplier",
  "type": "derived",
  "config": {
    "formula": "(attr_generosity / 10) * (var_hunger > 50 ? 1.2 : 0.8)",
    "min": 0.5,
    "max": 2.0
  }
}
```

Derived values recalculate automatically when dependencies change.

## Why This Architecture?

### Benefits

1. **Emergent Behavior** - Complex interactions from simple rules
2. **Data-Driven** - No code changes for new content
3. **Testable** - Deterministic with seeded random
4. **Debuggable** - Can trace why any state exists

### Trade-offs

1. **Learning Curve** - Relationship system takes time to master
2. **Performance** - Many relationships = many calculations per tick
3. **Complexity** - Hard to predict emergent behavior in large configs

## Example: Tavern Patron

The included tavern patron config demonstrates:

- 4 attributes influencing personality selection
- 4 variables that deplete/accumulate over time
- 10 personality and mood traits with incompatibilities
- 8 modifiers triggered by variable thresholds
- 4 compound states (Hangry, Jolly Drunk, Wallflower, Life of the Party)
- 35+ relationships creating emergent behavior

A patron with high Patience and low Sociability will likely be Mellow and Introverted, boredom will accumulate slowly, and if they become Bored Stiff, the Wallflower compound activates.
