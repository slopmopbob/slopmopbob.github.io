/**
 * Hierarchical State Engine - Portfolio Edition
 *
 * A configurable engine for generating entities with layered traits,
 * dynamic variables, and emergent compound states.
 *
 * @version 1.0.0
 * @author Shane Ostrom
 * @license MIT
 * @see {@link https://shaneostrom.com} for documentation
 */

class SpawnEngine {
    /**
     * Create a new SpawnEngine instance.
     * @param {Object} [config] - Configuration object to load
     */
    constructor(config = null) {
        this.config = null;
        this.nodeIndex = new Map();
        this.relationshipIndex = {
            bySource: new Map(),
            byTarget: new Map(),
            byType: new Map()
        };
        this.entities = new Map();
        this.listeners = new Map();

        if (config) {
            this.loadConfig(config);
        }
    }

    // ========================================
    // CONFIGURATION
    // ========================================

    /**
     * Load and process a configuration object.
     * @param {Object} config - Configuration with nodes and relationships
     * @returns {SpawnEngine} This instance for chaining
     */
    loadConfig(config) {
        this.config = this._normalizeConfig(config);
        this._buildIndexes();
        return this;
    }

    _normalizeConfig(config) {
        return {
            id: config.id || 'unnamed-config',
            name: config.name || 'Unnamed Config',
            version: config.version || '1.0',
            description: config.description || '',
            nodes: (config.nodes || []).map(node => ({
                id: node.id,
                name: node.name || node.id,
                description: node.description || '',
                type: node.type,
                config: node.config || {}
            })),
            relationships: (config.relationships || []).map(rel => ({
                id: rel.id || `rel_${rel.sourceId}_${rel.targetId}`,
                sourceId: rel.sourceId,
                targetId: rel.targetId,
                type: rel.type,
                config: {
                    operation: rel.config?.operation || 'add',
                    value: rel.config?.value ?? 0,
                    scaling: rel.config?.scaling || 'flat',
                    perPointSource: rel.config?.perPointSource || null
                },
                conditions: rel.conditions || []
            })),
            engineConfig: {
                tickRate: config.engineConfig?.tickRate ?? 1000
            }
        };
    }

    _buildIndexes() {
        this.nodeIndex.clear();
        this.relationshipIndex.bySource.clear();
        this.relationshipIndex.byTarget.clear();
        this.relationshipIndex.byType.clear();

        for (const node of this.config.nodes) {
            this.nodeIndex.set(node.id, node);
        }

        for (const rel of this.config.relationships) {
            if (!this.relationshipIndex.bySource.has(rel.sourceId)) {
                this.relationshipIndex.bySource.set(rel.sourceId, []);
            }
            this.relationshipIndex.bySource.get(rel.sourceId).push(rel);

            if (!this.relationshipIndex.byTarget.has(rel.targetId)) {
                this.relationshipIndex.byTarget.set(rel.targetId, []);
            }
            this.relationshipIndex.byTarget.get(rel.targetId).push(rel);

            if (!this.relationshipIndex.byType.has(rel.type)) {
                this.relationshipIndex.byType.set(rel.type, []);
            }
            this.relationshipIndex.byType.get(rel.type).push(rel);
        }
    }

    // ========================================
    // NODE QUERIES
    // ========================================

    /**
     * Get a node by ID.
     * @param {string} nodeId - The node ID
     * @returns {Object|null} The node or null
     */
    getNode(nodeId) {
        return this.nodeIndex.get(nodeId) || null;
    }

    /**
     * Get all nodes of a specific type.
     * @param {string} type - Node type
     * @returns {Object[]} Matching nodes
     */
    getNodesByType(type) {
        return this.config.nodes.filter(n => n.type === type);
    }

    getAttributes() { return this.getNodesByType('attribute'); }
    getVariables() { return this.getNodesByType('variable'); }
    getModifiers() { return this.getNodesByType('modifier'); }
    getCompounds() { return this.getNodesByType('compound'); }
    getDerived() { return this.getNodesByType('derived'); }

    getLayers() {
        return this.getNodesByType('layer').sort((a, b) =>
            (a.config.order || 0) - (b.config.order || 0)
        );
    }

    getLayerTraits(layerId) {
        const layer = this.getNode(layerId);
        if (!layer || layer.type !== 'layer') return [];
        const ids = layer.config.traitIds || layer.config.itemIds || [];
        return ids.map(id => this.getNode(id)).filter(Boolean);
    }

    getRelationshipsFrom(nodeId) {
        return this.relationshipIndex.bySource.get(nodeId) || [];
    }

    getRelationshipsTo(nodeId) {
        return this.relationshipIndex.byTarget.get(nodeId) || [];
    }

    // ========================================
    // ENTITY GENERATION
    // ========================================

    /**
     * Spawn a new entity with random attributes and traits.
     * @param {Object} [overrides] - Optional overrides
     * @returns {Object} The spawned entity
     */
    spawn(overrides = {}) {
        const entityId = overrides.id || `entity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const entity = {
            id: entityId,
            configId: this.config.id,
            createdAt: Date.now(),
            attributes: {},
            variables: {},
            contexts: {},
            layers: {},
            modifiers: [],
            compounds: [],
            derived: {},
            _modifierStates: {},
            _internal: { lastTick: Date.now() }
        };

        // Roll attributes
        for (const attr of this.getAttributes()) {
            const cfg = attr.config;
            const min = cfg.defaultRange?.[0] ?? cfg.min ?? 1;
            const max = cfg.defaultRange?.[1] ?? cfg.max ?? 10;
            entity.attributes[attr.id] = overrides.attributes?.[attr.id] ??
                this._rollRange(min, max, cfg.precision);
        }

        // Initialize variables
        for (const varNode of this.getVariables()) {
            const cfg = varNode.config;
            entity.variables[varNode.id] = {
                value: cfg.initial ?? 100,
                baseRate: cfg.baseRate ?? 0,
                currentRate: cfg.baseRate ?? 0,
                min: cfg.min ?? 0,
                max: cfg.max ?? 100,
                changeMode: cfg.changeMode || 'manual',
                direction: cfg.direction || 'none'
            };
        }

        // Initialize contexts
        for (const ctx of this.getNodesByType('context')) {
            entity.contexts[ctx.id] = overrides.contexts?.[ctx.id] ?? ctx.config.default;
        }

        // Initialize layer containers
        for (const layer of this.getLayers()) {
            entity.layers[layer.id] = { active: [], lastRoll: null };
        }

        // Roll initial traits for each layer
        for (const layer of this.getLayers()) {
            const initialRolls = layer.config.selection?.initialRolls || 1;
            for (let i = 0; i < initialRolls; i++) {
                this.rollLayer(entity, layer.id);
            }
        }

        // Force any specified traits
        for (const traitId of overrides.forceTraits || []) {
            this._forceActivateTrait(entity, traitId);
        }

        // Apply custom properties from overrides
        if (overrides.displayName) entity.displayName = overrides.displayName;
        if (overrides.custom) Object.assign(entity, overrides.custom);

        // Calculate emergent states
        this._checkCompounds(entity);
        this._calculateDerived(entity);
        this._recalculateRates(entity);

        this.entities.set(entity.id, entity);
        this.emit('entitySpawned', { entity });

        return entity;
    }

    /**
     * Remove an entity.
     * @param {string} entityId - Entity ID
     * @returns {boolean} True if removed
     */
    despawn(entityId) {
        const existed = this.entities.delete(entityId);
        if (existed) this.emit('entityDespawned', { entityId });
        return existed;
    }

    /**
     * Get an entity by ID.
     * @param {string} entityId - Entity ID
     * @returns {Object|null} The entity or null
     */
    getEntity(entityId) {
        return this.entities.get(entityId) || null;
    }

    /**
     * Get all spawned entities.
     * @returns {Object[]} All entities
     */
    getAllEntities() {
        return Array.from(this.entities.values());
    }

    // ========================================
    // TRAIT SELECTION
    // ========================================

    /**
     * Roll a layer to select a trait.
     * @param {Object} entity - The entity
     * @param {string} layerId - Layer ID
     * @returns {Object} Result with selected trait
     */
    rollLayer(entity, layerId) {
        const layer = this.getNode(layerId);
        if (!layer || layer.type !== 'layer') {
            return { success: false, error: 'Invalid layer' };
        }

        const selection = layer.config.selection || {};
        const maxItems = selection.maxItems ?? 10;
        const currentActive = entity.layers[layerId]?.active || [];

        if (currentActive.length >= maxItems) {
            return { success: false, error: 'Layer at capacity' };
        }

        const traits = this.getLayerTraits(layerId);
        const pool = [];

        for (const trait of traits) {
            if (currentActive.includes(trait.id)) continue;
            if (trait.config.selection?.mode === 'threshold') continue;
            if (!this._checkEligibility(entity, trait)) continue;
            if (this._hasIncompatibility(entity, trait)) continue;

            const weight = this._calculateWeight(entity, trait);
            if (weight > 0) pool.push({ trait, weight });
        }

        if (pool.length === 0) {
            return { success: false, error: 'No eligible traits' };
        }

        // Weighted random selection
        const totalWeight = pool.reduce((sum, p) => sum + p.weight, 0);
        let roll = Math.random() * totalWeight;

        for (const { trait, weight } of pool) {
            roll -= weight;
            if (roll <= 0) {
                this._activateTrait(entity, trait.id);
                return { success: true, selected: [trait.id] };
            }
        }

        return { success: true, selected: [pool[0].trait.id] };
    }

    _calculateWeight(entity, trait) {
        const selection = trait.config.selection || {};
        let weight = selection.baseWeight ?? 20;

        // Apply weight modifiers from conditions
        for (const mod of selection.weightModifiers || []) {
            if (this._evaluateCondition(entity, mod.condition)) {
                if (mod.operation === 'add') weight += mod.value;
                else if (mod.operation === 'multiply') weight *= mod.value;
            }
        }

        // Apply relationship-based weight influences
        const influences = this.getRelationshipsTo(trait.id)
            .filter(r => r.type === 'weight_influence');

        for (const rel of influences) {
            if (!this._isNodeActive(entity, rel.sourceId)) continue;
            if (!this._evaluateConditions(entity, rel.conditions)) continue;

            const value = this._calculateRelationshipValue(entity, rel);
            if (rel.config.operation === 'add') weight += value;
            else if (rel.config.operation === 'multiply') weight *= value;
        }

        return Math.max(0, weight);
    }

    _checkEligibility(entity, trait) {
        return this._evaluateConditions(entity, trait.config.eligibility || []);
    }

    _hasIncompatibility(entity, trait) {
        for (const incompId of trait.config.incompatibleWith || []) {
            if (this._isNodeActive(entity, incompId)) return true;
        }
        return false;
    }

    // ========================================
    // TRAIT ACTIVATION
    // ========================================

    /**
     * Activate a trait for an entity.
     * @param {string|Object} entityOrId - Entity or ID
     * @param {string} traitId - Trait ID
     * @returns {boolean} Success
     */
    activateTrait(entityOrId, traitId) {
        const entity = typeof entityOrId === 'string' ? this.getEntity(entityOrId) : entityOrId;
        if (!entity) return false;

        const result = this._activateTrait(entity, traitId);
        if (result) {
            this._recalculateRates(entity);
            this._checkCompounds(entity);
            this._calculateDerived(entity);
            this.emit('traitActivated', { entityId: entity.id, traitId });
        }
        return result;
    }

    /**
     * Deactivate a trait for an entity.
     * @param {string|Object} entityOrId - Entity or ID
     * @param {string} traitId - Trait ID
     * @returns {boolean} Success
     */
    deactivateTrait(entityOrId, traitId) {
        const entity = typeof entityOrId === 'string' ? this.getEntity(entityOrId) : entityOrId;
        if (!entity) return false;

        const result = this._deactivateTrait(entity, traitId);
        if (result) {
            this._recalculateRates(entity);
            this._checkCompounds(entity);
            this._calculateDerived(entity);
            this.emit('traitDeactivated', { entityId: entity.id, traitId });
        }
        return result;
    }

    _activateTrait(entity, traitId) {
        const trait = this.getNode(traitId);
        if (!trait || (trait.type !== 'trait' && trait.type !== 'item')) return false;

        const layerId = trait.config.layerId;
        if (!entity.layers[layerId]) {
            entity.layers[layerId] = { active: [], lastRoll: null };
        }

        if (entity.layers[layerId].active.includes(traitId)) return false;

        // Handle replacements
        for (const replaceId of trait.config.selection?.replaces || []) {
            this._deactivateTrait(entity, replaceId);
        }

        entity.layers[layerId].active.push(traitId);
        return true;
    }

    _forceActivateTrait(entity, traitId) {
        const trait = this.getNode(traitId);
        if (!trait || (trait.type !== 'trait' && trait.type !== 'item')) return false;

        const layerId = trait.config.layerId;
        if (!entity.layers[layerId]) {
            entity.layers[layerId] = { active: [], lastRoll: null };
        }

        if (!entity.layers[layerId].active.includes(traitId)) {
            entity.layers[layerId].active.push(traitId);
        }
        return true;
    }

    _deactivateTrait(entity, traitId) {
        const trait = this.getNode(traitId);
        if (!trait || (trait.type !== 'trait' && trait.type !== 'item')) return false;

        const layerId = trait.config.layerId;
        if (!entity.layers[layerId]) return false;

        const index = entity.layers[layerId].active.indexOf(traitId);
        if (index === -1) return false;

        entity.layers[layerId].active.splice(index, 1);
        return true;
    }

    // ========================================
    // TICK SYSTEM
    // ========================================

    /**
     * Advance time for an entity, updating variables.
     * @param {string|Object} entityOrId - Entity or ID
     * @param {number} [deltaSeconds] - Time delta (auto-calculated if omitted)
     * @returns {Object|null} Updated entity
     */
    tick(entityOrId, deltaSeconds = null) {
        const entity = typeof entityOrId === 'string' ? this.getEntity(entityOrId) : entityOrId;
        if (!entity) return null;

        const now = Date.now();
        if (deltaSeconds === null) {
            deltaSeconds = (now - entity._internal.lastTick) / 1000;
        }
        entity._internal.lastTick = now;

        // Update timed variables
        for (const [varId, varState] of Object.entries(entity.variables)) {
            if (varState.changeMode === 'timed' && varState.direction !== 'none') {
                const oldValue = varState.value;
                varState.value += varState.currentRate * deltaSeconds;
                varState.value = Math.max(varState.min, Math.min(varState.max, varState.value));

                if (varState.value !== oldValue) {
                    this._checkThresholds(entity, varId);
                    this.emit('variableChanged', {
                        entityId: entity.id, varId, oldValue, newValue: varState.value
                    });
                }
            }
        }

        // Expire modifiers
        const expiredModifiers = [];
        for (const modId of entity.modifiers) {
            const modState = entity._modifierStates[modId];
            if (modState?.expiresAt && now >= modState.expiresAt) {
                expiredModifiers.push(modId);
            } else if (modState?.ticksRemaining !== undefined) {
                modState.ticksRemaining--;
                if (modState.ticksRemaining <= 0) expiredModifiers.push(modId);
            }
        }

        for (const modId of expiredModifiers) {
            this.removeModifier(entity, modId);
        }

        this._calculateDerived(entity);
        this.emit('tick', { entityId: entity.id, deltaSeconds });

        return entity;
    }

    /**
     * Advance time for all entities.
     * @param {number} [deltaSeconds] - Time delta
     */
    tickAll(deltaSeconds = null) {
        for (const entityId of this.entities.keys()) {
            this.tick(entityId, deltaSeconds);
        }
    }

    // ========================================
    // VARIABLES
    // ========================================

    /**
     * Modify a variable by a delta amount.
     * @param {string|Object} entityOrId - Entity or ID
     * @param {string} varId - Variable ID
     * @param {number} delta - Change amount
     * @returns {boolean} Success
     */
    modifyVariable(entityOrId, varId, delta) {
        const entity = typeof entityOrId === 'string' ? this.getEntity(entityOrId) : entityOrId;
        if (!entity) return false;

        const varState = entity.variables[varId];
        if (!varState) return false;

        const oldValue = varState.value;
        varState.value = Math.max(varState.min, Math.min(varState.max, varState.value + delta));

        if (varState.value !== oldValue) {
            this._checkThresholds(entity, varId);
            this._calculateDerived(entity);
            this.emit('variableChanged', { entityId: entity.id, varId, oldValue, newValue: varState.value });
        }

        return true;
    }

    /**
     * Set a variable to an absolute value.
     * @param {string|Object} entityOrId - Entity or ID
     * @param {string} varId - Variable ID
     * @param {number} value - New value
     * @returns {boolean} Success
     */
    setVariable(entityOrId, varId, value) {
        const entity = typeof entityOrId === 'string' ? this.getEntity(entityOrId) : entityOrId;
        if (!entity) return false;

        const varState = entity.variables[varId];
        if (!varState) return false;

        const oldValue = varState.value;
        varState.value = Math.max(varState.min, Math.min(varState.max, value));

        if (varState.value !== oldValue) {
            this._checkThresholds(entity, varId);
            this._calculateDerived(entity);
            this.emit('variableChanged', { entityId: entity.id, varId, oldValue, newValue: varState.value });
        }

        return true;
    }

    // ========================================
    // MODIFIERS
    // ========================================

    /**
     * Apply a modifier to an entity.
     * @param {string|Object} entityOrId - Entity or ID
     * @param {string} modifierId - Modifier ID
     * @returns {boolean} Success
     */
    applyModifier(entityOrId, modifierId) {
        const entity = typeof entityOrId === 'string' ? this.getEntity(entityOrId) : entityOrId;
        if (!entity) return false;

        const modifier = this.getNode(modifierId);
        if (!modifier || modifier.type !== 'modifier') return false;

        const config = modifier.config || {};
        const existing = entity.modifiers.includes(modifierId);

        if (existing && entity._modifierStates[modifierId]) {
            const modState = entity._modifierStates[modifierId];
            if (config.stacking === 'refresh' && config.duration) {
                modState.appliedAt = Date.now();
                if (config.durationType === 'timed') {
                    modState.expiresAt = Date.now() + (config.duration * 1000);
                }
            } else if (config.stacking === 'stack') {
                modState.stacks = Math.min((modState.stacks || 1) + 1, config.maxStacks || 99);
            }
        } else {
            entity.modifiers.push(modifierId);
            entity._modifierStates[modifierId] = {
                appliedAt: Date.now(),
                stacks: 1,
                expiresAt: config.durationType === 'timed' && config.duration
                    ? Date.now() + (config.duration * 1000) : null,
                ticksRemaining: config.durationType === 'ticks' ? config.duration : undefined
            };
        }

        this._recalculateRates(entity);
        this._checkCompounds(entity);
        this._calculateDerived(entity);
        this.emit('modifierApplied', { entityId: entity.id, modifierId });

        return true;
    }

    /**
     * Remove a modifier from an entity.
     * @param {string|Object} entityOrId - Entity or ID
     * @param {string} modifierId - Modifier ID
     * @returns {boolean} Success
     */
    removeModifier(entityOrId, modifierId) {
        const entity = typeof entityOrId === 'string' ? this.getEntity(entityOrId) : entityOrId;
        if (!entity) return false;

        const index = entity.modifiers.indexOf(modifierId);
        if (index === -1) return false;

        entity.modifiers.splice(index, 1);
        delete entity._modifierStates[modifierId];

        this._recalculateRates(entity);
        this._checkCompounds(entity);
        this._calculateDerived(entity);
        this.emit('modifierRemoved', { entityId: entity.id, modifierId });

        return true;
    }

    // ========================================
    // STATE QUERIES
    // ========================================

    /**
     * Get a summarized state view of an entity.
     * @param {string} entityId - Entity ID
     * @returns {Object|null} State summary
     */
    getState(entityId) {
        const entity = this.getEntity(entityId);
        if (!entity) return null;

        const activeTraits = [];
        for (const [layerId, layerState] of Object.entries(entity.layers)) {
            for (const traitId of layerState.active) {
                const trait = this.getNode(traitId);
                activeTraits.push({ id: traitId, name: trait?.name || traitId, layerId });
            }
        }

        const activeModifiers = entity.modifiers.map(modId => {
            const mod = this.getNode(modId);
            const state = entity._modifierStates[modId] || {};
            return { id: modId, name: mod?.name || modId, stacks: state.stacks };
        });

        const activeCompounds = entity.compounds.map(compId => {
            const comp = this.getNode(compId);
            return { id: compId, name: comp?.name || compId };
        });

        return {
            id: entity.id,
            createdAt: entity.createdAt,
            attributes: { ...entity.attributes },
            variables: Object.fromEntries(
                Object.entries(entity.variables).map(([k, v]) => [k, {
                    value: v.value,
                    min: v.min,
                    max: v.max,
                    currentRate: v.currentRate
                }])
            ),
            activeTraits,
            activeModifiers,
            activeCompounds,
            derived: { ...entity.derived }
        };
    }

    // ========================================
    // EVENTS
    // ========================================

    /**
     * Subscribe to an event.
     * @param {string} event - Event name
     * @param {Function} callback - Handler function
     * @returns {Function} Unsubscribe function
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);

        return () => {
            const callbacks = this.listeners.get(event);
            const index = callbacks.indexOf(callback);
            if (index > -1) callbacks.splice(index, 1);
        };
    }

    /**
     * Emit an event.
     * @param {string} event - Event name
     * @param {Object} data - Event data
     */
    emit(event, data) {
        const callbacks = this.listeners.get(event) || [];
        for (const callback of callbacks) {
            try {
                callback(data);
            } catch (e) {
                console.error(`Error in event handler for '${event}':`, e);
            }
        }
    }

    // ========================================
    // INTERNAL HELPERS
    // ========================================

    _checkCompounds(entity) {
        for (const compound of this.getCompounds()) {
            const isActive = entity.compounds.includes(compound.id);
            const requirementsMet = this._checkCompoundRequirements(entity, compound);

            if (requirementsMet && !isActive) {
                entity.compounds.push(compound.id);
                this.emit('compoundActivated', { entityId: entity.id, compoundId: compound.id });
            } else if (!requirementsMet && isActive) {
                const index = entity.compounds.indexOf(compound.id);
                if (index > -1) {
                    entity.compounds.splice(index, 1);
                    this.emit('compoundDeactivated', { entityId: entity.id, compoundId: compound.id });
                }
            }
        }
    }

    _checkCompoundRequirements(entity, compound) {
        const requires = compound.config.requires || [];
        const logic = compound.config.requirementLogic || 'all';

        if (requires.length === 0) return false;

        const results = requires.map(req => {
            if (req.item || req.trait) {
                return this._isNodeActive(entity, req.item || req.trait);
            } else if (req.modifier) {
                return entity.modifiers.includes(req.modifier);
            } else if (req.condition) {
                return this._evaluateCondition(entity, req.condition);
            }
            return false;
        });

        return logic === 'all' ? results.every(r => r) : results.some(r => r);
    }

    _calculateDerived(entity) {
        for (const derived of this.getDerived()) {
            const cfg = derived.config;
            const formula = cfg.formula;

            try {
                const context = {
                    ...entity.attributes,
                    ...Object.fromEntries(
                        Object.entries(entity.variables).map(([k, v]) => [k, v.value])
                    ),
                    ...entity.contexts
                };

                const value = this._evaluateFormula(formula, context);
                entity.derived[derived.id] = Math.max(
                    cfg.min ?? -Infinity,
                    Math.min(cfg.max ?? Infinity, value)
                );
            } catch (e) {
                entity.derived[derived.id] = 0;
            }
        }
    }

    _recalculateRates(entity) {
        for (const varNode of this.getVariables()) {
            const varState = entity.variables[varNode.id];
            if (!varState) continue;

            let rate = varState.baseRate;

            const rateRels = this.getRelationshipsTo(varNode.id)
                .filter(r => r.type === 'rate_modifier');

            for (const rel of rateRels) {
                if (!this._isNodeActive(entity, rel.sourceId)) continue;
                if (!this._evaluateConditions(entity, rel.conditions)) continue;

                const value = this._calculateRelationshipValue(entity, rel);
                if (rel.config.operation === 'add') rate += value;
                else if (rel.config.operation === 'multiply') rate *= value;
            }

            varState.currentRate = rate;
        }
    }

    _checkThresholds(entity, varId) {
        const varState = entity.variables[varId];

        // Check traits/items with threshold selection mode
        const traits = this.config.nodes.filter(n =>
            (n.type === 'trait' || n.type === 'item') &&
            n.config.selection?.mode === 'threshold' &&
            n.config.selection?.trigger?.target === varId
        );

        for (const trait of traits) {
            const trigger = trait.config.selection.trigger;
            const autoRemove = trait.config.selection.autoRemove;
            const layerId = trait.config.layerId;
            const isActive = entity.layers[layerId]?.active?.includes(trait.id);

            if (!isActive && this._evaluateThreshold(varState.value, trigger)) {
                this.activateTrait(entity, trait.id);
            }

            if (isActive && autoRemove && this._evaluateThreshold(varState.value, autoRemove)) {
                this.deactivateTrait(entity, trait.id);
            }
        }

        // Check modifiers with threshold trigger type
        const modifiers = this.config.nodes.filter(n =>
            n.type === 'modifier' &&
            n.config.triggerType === 'threshold' &&
            n.config.trigger?.target === varId
        );

        for (const modifier of modifiers) {
            const trigger = modifier.config.trigger;
            const autoRemove = modifier.config.autoRemove;
            const isActive = entity.modifiers.includes(modifier.id);

            // Apply modifier if threshold is met and not already active
            if (!isActive && this._evaluateThreshold(varState.value, trigger)) {
                this.applyModifier(entity, modifier.id);
            }

            // Remove modifier if autoRemove threshold is met
            if (isActive && autoRemove && this._evaluateThreshold(varState.value, autoRemove)) {
                this.removeModifier(entity, modifier.id);
            }
        }
    }

    _evaluateThreshold(value, condition) {
        if (!condition) return false;
        const threshold = condition.value;
        switch (condition.operator || condition.op) {
            case '<': return value < threshold;
            case '<=': return value <= threshold;
            case '>': return value > threshold;
            case '>=': return value >= threshold;
            case '==': return value === threshold;
            case '!=': return value !== threshold;
            default: return false;
        }
    }

    _evaluateConditions(entity, conditions) {
        if (!conditions || conditions.length === 0) return true;
        return conditions.every(cond => this._evaluateCondition(entity, cond));
    }

    _evaluateCondition(entity, condition) {
        if (!condition) return true;

        if (condition.all) {
            return condition.all.every(c => this._evaluateCondition(entity, c));
        }
        if (condition.any) {
            return condition.any.some(c => this._evaluateCondition(entity, c));
        }
        if (condition.not) {
            return !this._evaluateCondition(entity, condition.not);
        }

        const { type, target, operator, value } = condition;
        let actualValue;

        switch (type) {
            case 'attribute': actualValue = entity.attributes[target]; break;
            case 'variable': actualValue = entity.variables[target]?.value; break;
            case 'context': actualValue = entity.contexts[target]; break;
            case 'trait':
            case 'item':
                return this._isNodeActive(entity, target);
            case 'modifier': return entity.modifiers.includes(target);
            case 'compound': return entity.compounds.includes(target);
            default: return false;
        }

        return this._compareValues(actualValue, operator, value);
    }

    _compareValues(actual, operator, expected) {
        switch (operator) {
            case '<': case 'lt': return actual < expected;
            case '<=': case 'lte': return actual <= expected;
            case '>': case 'gt': return actual > expected;
            case '>=': case 'gte': return actual >= expected;
            case '==': case 'eq': return actual == expected;
            case '===': return actual === expected;
            case '!=': case 'ne': return actual != expected;
            case '!==': return actual !== expected;
            default: return false;
        }
    }

    _isNodeActive(entity, nodeId) {
        const node = this.getNode(nodeId);
        if (!node) return false;

        if (node.type === 'trait' || node.type === 'item') {
            const layerId = node.config.layerId;
            return entity.layers[layerId]?.active?.includes(nodeId) || false;
        }

        switch (node.type) {
            case 'modifier': return entity.modifiers.includes(nodeId);
            case 'compound': return entity.compounds.includes(nodeId);
            case 'attribute':
            case 'variable':
            case 'context':
                return true;
            default: return false;
        }
    }

    _calculateRelationshipValue(entity, rel) {
        let value = rel.config.value;
        if (rel.config.scaling === 'perPoint' && rel.config.perPointSource) {
            const sourceNode = this.getNode(rel.config.perPointSource);
            if (sourceNode) {
                if (sourceNode.type === 'attribute') {
                    value *= entity.attributes[rel.config.perPointSource] ?? 0;
                } else if (sourceNode.type === 'variable') {
                    value *= entity.variables[rel.config.perPointSource]?.value ?? 0;
                }
            }
        }
        return value;
    }

    _rollRange(min, max, precision = 0) {
        const value = min + Math.random() * (max - min);
        if (precision === 0) return Math.round(value);
        const factor = Math.pow(10, precision);
        return Math.round(value * factor) / factor;
    }

    _evaluateFormula(formula, context) {
        const keys = Object.keys(context);
        const values = Object.values(context);
        const fn = new Function(...keys, `return ${formula}`);
        return fn(...values);
    }
}

// Export for different module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SpawnEngine };
} else if (typeof window !== 'undefined') {
    window.SpawnEngine = SpawnEngine;
}
