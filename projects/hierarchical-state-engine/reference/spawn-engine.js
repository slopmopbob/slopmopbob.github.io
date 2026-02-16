/**
 * Spawn Engine v3 - Browser Bundle
 *
 * A configurable hierarchical state engine for generating entities with
 * layered traits, dynamic variables, and emergent compound states.
 *
 * Two-part architecture:
 * - SpawnManager: Pure generation logic (the brain)
 * - EntityManager: Storage & runtime state (the filing cabinet + clock)
 * - SpawnEngine: Convenience wrapper combining both
 *
 * @module SpawnEngine
 * @version 3.0
 * @author Shane Ostrom
 * @license MIT
 * @see {@link https://shaneostrom.com} for documentation
 */

// ============================================================================
// SPAWN MANAGER - Pure Generation Logic
// ============================================================================

/**
 * Pure generation logic for creating entity snapshots.
 * Handles config loading, attribute rolling, trait selection, and relationship calculations.
 * Does not manage runtime state - use EntityManager for that.
 *
 * @class SpawnManager
 * @example
 * const manager = new SpawnManager(config);
 * const entity = manager.generate();
 * console.log(entity.attributes);
 */
class SpawnManager {
    /**
     * Create a new SpawnManager instance.
     *
     * @param {Object|null} [config=null] - Configuration object to load immediately
     * @example
     * // Create without config
     * const manager = new SpawnManager();
     * manager.loadConfig(myConfig);
     *
     * // Create with config
     * const manager = new SpawnManager(myConfig);
     */
    constructor(config = null) {
        /** @type {Object|null} Current configuration */
        this.config = null;
        /** @type {Map<string, Object>} Node lookup index */
        this.nodeIndex = new Map();
        /** @type {Object} Relationship indexes by source, target, and type */
        this.relationshipIndex = {
            bySource: new Map(),
            byTarget: new Map(),
            byType: new Map()
        };
        /** @type {Map<string, Array<Object>>} Cached nodes grouped by type */
        this._nodesByType = new Map();
        /** @type {Map<string, {fn: Function, keys: string[]}>} Compiled formula cache */
        this._formulaCache = new Map();
        /** @type {Array<Object>} Pre-filtered threshold modifier nodes */
        this._thresholdModifiers = [];
        /** @type {Map<string, Array<Object>>} Threshold traits indexed by target variable ID */
        this._thresholdTraitsByVar = new Map();
        /** @type {Map<string, Set<string>>} Pre-computed exclusive modifier groups */
        this._exclusiveGroups = new Map();
        /** @type {EntityManager|null} Linked EntityManager for preset access */
        this.entityManager = null;

        if (config) {
            this.loadConfig(config);
        }
    }

    /**
     * Link an EntityManager for preset and runtime integration.
     *
     * @param {EntityManager} entityManager - The EntityManager to link
     * @returns {SpawnManager} This instance for chaining
     * @example
     * const spawnManager = new SpawnManager(config);
     * const entityManager = new EntityManager();
     * spawnManager.linkEntityManager(entityManager);
     */
    linkEntityManager(entityManager) {
        this.entityManager = entityManager;
        return this;
    }

    // ========================================
    // CONFIG MANAGEMENT
    // ========================================

    /**
     * Load and process a configuration object.
     * Validates, normalizes, and builds lookup indexes.
     *
     * @param {Object} config - Configuration object
     * @param {string} config.id - Unique configuration ID
     * @param {string} config.name - Display name
     * @param {Array<Object>} config.nodes - Node definitions
     * @param {Array<Object>} [config.relationships] - Relationship definitions
     * @returns {SpawnManager} This instance for chaining
     * @example
     * manager.loadConfig({
     *   id: 'my-config',
     *   name: 'My Config',
     *   nodes: [...],
     *   relationships: [...]
     * });
     */
    loadConfig(config) {
        this.config = this.validateAndNormalize(config);
        this.buildIndexes();
        this._formulaCache.clear();
        return this;
    }

    validateAndNormalize(config) {
        const normalized = {
            id: config.id || 'unnamed-config',
            name: config.name || 'Unnamed Config',
            version: config.version || '3.0',
            tier: config.tier || 'free',
            description: config.description || '',
            nodes: config.nodes || [],
            relationships: config.relationships || [],
            presetGroups: config.presetGroups || [],
            presets: config.presets || [],
            engineConfig: {
                tickRate: config.engineConfig?.tickRate ?? 1000,
                maxEntities: config.engineConfig?.maxEntities ?? config.engineConfig?.maxSpawns ?? null
            }
        };

        normalized.nodes = normalized.nodes.map(node => {
            const normalizedNode = {
                id: node.id,
                name: node.name || node.id,
                description: node.description || '',
                type: node.type,
                tags: node.tags || [],
                taxonomy: node.taxonomy || null,  // Hierarchical categorization
                position: node.position || null,
                config: node.config || {}
            };

            // Modifier-specific normalization for backwards compatibility
            if (node.type === 'modifier' && normalizedNode.config) {
                const cfg = normalizedNode.config;

                // Convert 'manual' durationType to 'permanent'
                if (cfg.durationType === 'manual') {
                    cfg.durationType = 'permanent';
                }

                // Normalize trigger configuration
                if (cfg.trigger) {
                    // Convert single-condition trigger to conditions array
                    if (cfg.trigger.type === 'threshold' && cfg.trigger.target && !cfg.trigger.conditions) {
                        cfg.trigger.conditions = [{
                            target: cfg.trigger.target,
                            operator: cfg.trigger.operator || '<=',
                            value: cfg.trigger.value ?? 0
                        }];
                        cfg.trigger.logic = cfg.trigger.logic || 'all';
                    }

                    // Convert old autoRemove to static mode with removeConditions
                    if (cfg.trigger.autoRemove && !cfg.trigger.removeConditions) {
                        cfg.trigger.static = true;
                        cfg.trigger.removeConditions = [{
                            target: cfg.trigger.autoRemove.target || cfg.trigger.target,
                            operator: cfg.trigger.autoRemove.operator || '>=',
                            value: cfg.trigger.autoRemove.value ?? 0
                        }];
                        cfg.trigger.removeLogic = cfg.trigger.removeLogic || 'all';
                    }
                }

                // Normalize exclusiveWith to always be an array
                if (cfg.exclusiveWith) {
                    if (!Array.isArray(cfg.exclusiveWith)) {
                        cfg.exclusiveWith = [cfg.exclusiveWith];
                    }
                } else {
                    cfg.exclusiveWith = [];
                }
            }

            return normalizedNode;
        });

        normalized.relationships = normalized.relationships.map(rel => ({
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
        }));

        // Normalize preset groups
        normalized.presetGroups = normalized.presetGroups.map(group => ({
            id: group.id,
            name: group.name || group.id,
            description: group.description || '',
            parentId: group.parentId || null
        }));

        // Normalize presets
        normalized.presets = normalized.presets.map(preset => ({
            id: preset.id,
            name: preset.name || preset.id,
            description: preset.description || '',
            group: preset.group || null,
            tags: preset.tags || [],
            attributes: preset.attributes || {},
            contexts: preset.contexts || {},
            forceTraits: preset.forceTraits || [],
            traits: preset.traits || null,  // New structured trait selection
            taxonomy: preset.taxonomy || null,  // Hierarchical categorization
            actions: preset.actions || null,  // Action weight overrides
            attributeOverrides: preset.attributeOverrides || null,
            variableOverrides: preset.variableOverrides || null
        }));

        return normalized;
    }

    buildIndexes() {
        this.nodeIndex.clear();
        this.relationshipIndex.bySource.clear();
        this.relationshipIndex.byTarget.clear();
        this.relationshipIndex.byType.clear();
        this._nodesByType.clear();

        for (const node of this.config.nodes) {
            this.nodeIndex.set(node.id, node);
            // Group by type for O(1) lookups
            if (!this._nodesByType.has(node.type)) {
                this._nodesByType.set(node.type, []);
            }
            this._nodesByType.get(node.type).push(node);
        }

        // Combined trait cache (trait + item types)
        this._nodesByType.set('_traits', [
            ...(this._nodesByType.get('trait') || []),
            ...(this._nodesByType.get('item') || [])
        ]);

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

        // Pre-compute threshold modifiers (config-static)
        this._thresholdModifiers = (this._nodesByType.get('modifier') || []).filter(n =>
            n.config.trigger?.type === 'threshold'
        );

        // Pre-compute threshold traits grouped by target variable
        this._thresholdTraitsByVar.clear();
        const allTraits = this._nodesByType.get('_traits') || [];
        for (const trait of allTraits) {
            if (trait.config.selection?.mode === 'threshold') {
                const targetVar = trait.config.selection?.trigger?.target;
                if (targetVar) {
                    if (!this._thresholdTraitsByVar.has(targetVar)) {
                        this._thresholdTraitsByVar.set(targetVar, []);
                    }
                    this._thresholdTraitsByVar.get(targetVar).push(trait);
                }
            }
        }

        // Pre-compute exclusive modifier groups
        this._exclusiveGroups.clear();
        for (const mod of this._thresholdModifiers) {
            const exclusive = mod.config.exclusiveWith;
            if (exclusive && exclusive.length > 0) {
                if (!this._exclusiveGroups.has(mod.id)) this._exclusiveGroups.set(mod.id, new Set());
                for (const partnerId of exclusive) {
                    this._exclusiveGroups.get(mod.id).add(partnerId);
                    if (!this._exclusiveGroups.has(partnerId)) this._exclusiveGroups.set(partnerId, new Set());
                    this._exclusiveGroups.get(partnerId).add(mod.id);
                }
            }
        }
    }

    // ========================================
    // NODE QUERIES
    // ========================================

    /**
     * Get a node by its ID.
     *
     * @param {string} nodeId - The node ID to look up
     * @returns {Object|null} The node object or null if not found
     * @example
     * const strengthNode = manager.getNode('attr_strength');
     * console.log(strengthNode.name); // "Strength"
     */
    getNode(nodeId) {
        return this.nodeIndex.get(nodeId) || null;
    }

    /**
     * Get all nodes of a specific type.
     *
     * @param {string} type - Node type: 'attribute', 'variable', 'layer', 'trait', 'modifier', 'compound', 'derived'
     * @returns {Array<Object>} Array of matching nodes
     * @example
     * const attributes = manager.getNodesByType('attribute');
     * const traits = manager.getNodesByType('trait');
     */
    getNodesByType(type) {
        return this._nodesByType.get(type) || [];
    }

    /** @returns {Array<Object>} All attribute nodes */
    getAttributes() { return this.getNodesByType('attribute'); }
    /** @returns {Array<Object>} All variable nodes */
    getVariables() { return this.getNodesByType('variable'); }
    /** @returns {Array<Object>} All context nodes */
    getContexts() { return this.getNodesByType('context'); }
    /** @returns {Array<Object>} All modifier nodes */
    getModifiers() { return this.getNodesByType('modifier'); }
    /** @returns {Array<Object>} All compound nodes */
    getCompounds() { return this.getNodesByType('compound'); }
    /** @returns {Array<Object>} All derived value nodes */
    getDerived() { return this.getNodesByType('derived'); }

    /**
     * Get nodes matching a taxonomy filter.
     * Taxonomy provides hierarchical categorization (type/subtype/variant).
     *
     * @param {Object} filter - Taxonomy criteria to match
     * @returns {Array<Object>} Nodes matching all filter criteria
     * @example
     * // Get all humanoid items
     * manager.getNodesByTaxonomy({ type: 'humanoid' });
     *
     * // Get goblin variants specifically
     * manager.getNodesByTaxonomy({ type: 'humanoid', subtype: 'goblinoid' });
     */
    getNodesByTaxonomy(filter) {
        if (!filter || Object.keys(filter).length === 0) return [];
        return this.config.nodes.filter(n => {
            if (!n.taxonomy) return false;
            return Object.entries(filter).every(([key, value]) => n.taxonomy[key] === value);
        });
    }

    /**
     * Get all unique taxonomy values for a given level.
     *
     * @param {string} level - Taxonomy level ('type', 'subtype', 'variant')
     * @returns {string[]} Unique values at that level
     * @example
     * manager.getTaxonomyValues('type'); // ['humanoid', 'beast', 'undead']
     */
    getTaxonomyValues(level) {
        const values = new Set();
        for (const node of this.config.nodes) {
            if (node.taxonomy && node.taxonomy[level]) {
                values.add(node.taxonomy[level]);
            }
        }
        return Array.from(values).sort();
    }

    /**
     * Get all layer nodes, sorted by order.
     *
     * @returns {Array<Object>} Layer nodes sorted by config.order
     */
    getLayers() {
        return [...this.getNodesByType('layer')].sort((a, b) =>
            (a.config.order || 0) - (b.config.order || 0)
        );
    }

    /**
     * Get all spawnable nodes (attributes and layers) sorted by spawn order.
     * Used during entity generation to process nodes in the correct order,
     * allowing earlier-spawning traits to influence later-spawning attributes.
     *
     * @returns {Array<Object>} Nodes with type and order info, sorted by spawn order
     * @example
     * // Returns: [{ node: layerNode, type: 'layer', order: 0 }, { node: attrNode, type: 'attribute', order: 1 }, ...]
     */
    getSpawnOrder() {
        const items = [];

        // Add attributes with their spawn order
        for (const attr of this.getAttributes()) {
            items.push({
                node: attr,
                type: 'attribute',
                order: attr.config.spawnOrder ?? 0
            });
        }

        // Add layers that spawn at create/spawn time
        for (const layer of this.getNodesByType('layer')) {
            const timing = layer.config.timing || {};
            if (timing.rollAt === 'create' || timing.rollAt === 'spawn') {
                items.push({
                    node: layer,
                    type: 'layer',
                    order: layer.config.order ?? 0
                });
            }
        }

        // Sort by order (lower = earlier)
        return items.sort((a, b) => a.order - b.order);
    }

    /**
     * Calculate attribute range modifiers from active traits.
     * Used during spawn to allow traits to modify attribute rolls.
     *
     * @param {Object} entity - The entity being generated (may have partial state)
     * @param {Object} attr - The attribute node
     * @returns {Object} Modified range { min, max }
     */
    getModifiedAttributeRange(entity, attr) {
        const cfg = attr.config;
        let min = cfg.defaultRange?.[0] ?? cfg.min ?? 1;
        let max = cfg.defaultRange?.[1] ?? cfg.max ?? 10;

        // Find value_modifier relationships targeting this attribute
        const modifiers = this.getRelationshipsTo(attr.id)
            .filter(r => r.type === 'value_modifier');

        for (const rel of modifiers) {
            // Check if source is active (trait, modifier, etc.)
            if (!this.isNodeActive(entity, rel.sourceId)) continue;

            // Check conditions if any
            if (!this.evaluateConditions(entity, rel.conditions)) continue;

            const value = this.calculateRelationshipValue(entity, rel);
            const op = rel.config.operation || 'add';

            if (op === 'add') {
                min += value;
                max += value;
            } else if (op === 'multiply') {
                min *= value;
                max *= value;
            }
        }

        return { min, max };
    }

    /** @returns {Array<Object>} All action nodes */
    getActions() { return this.getNodesByType('action'); }

    /**
     * Get all traits belonging to a layer.
     *
     * @param {string} layerId - The layer ID
     * @returns {Array<Object>} Trait nodes in the layer
     * @example
     * const personalityTraits = manager.getLayerTraits('layer_personality');
     */
    getLayerTraits(layerId) {
        const layer = this.getNode(layerId);
        if (!layer || layer.type !== 'layer') return [];
        const ids = layer.config.traitIds || layer.config.itemIds || [];
        return ids.map(id => this.getNode(id)).filter(Boolean);
    }

    /**
     * Get all traits in a layer.
     * @deprecated Use getLayerTraits instead
     * @param {string} layerId - The layer ID
     * @returns {Array<Object>} Trait nodes
     */
    getLayerItems(layerId) { return this.getLayerTraits(layerId); }

    /**
     * Get all trait/item nodes in the configuration.
     *
     * @returns {Array<Object>} All trait and item nodes
     */
    getTraits() {
        return this._nodesByType.get('_traits') || [];
    }

    /**
     * Check if a node is a trait or item.
     *
     * @param {Object} node - Node to check
     * @returns {boolean} True if node is a trait or item
     */
    isTrait(node) {
        return node && (node.type === 'trait' || node.type === 'item');
    }

    // ========================================
    // RELATIONSHIP QUERIES
    // ========================================

    /**
     * Get all relationships where the given node is the source.
     *
     * @param {string} nodeId - Source node ID
     * @returns {Array<Object>} Relationships originating from this node
     * @example
     * const effects = manager.getRelationshipsFrom('attr_strength');
     * // Returns relationships where strength affects other nodes
     */
    getRelationshipsFrom(nodeId) {
        return this.relationshipIndex.bySource.get(nodeId) || [];
    }

    /**
     * Get all relationships where the given node is the target.
     *
     * @param {string} nodeId - Target node ID
     * @returns {Array<Object>} Relationships affecting this node
     * @example
     * const influences = manager.getRelationshipsTo('trait_warrior');
     * // Returns relationships that affect warrior selection weight
     */
    getRelationshipsTo(nodeId) {
        return this.relationshipIndex.byTarget.get(nodeId) || [];
    }

    /**
     * Get all relationships of a specific type.
     *
     * @param {string} type - Relationship type: 'weight_influence', 'rate_modifier', 'value_modifier'
     * @returns {Array<Object>} Relationships of the given type
     */
    getRelationshipsByType(type) {
        return this.relationshipIndex.byType.get(type) || [];
    }

    // ========================================
    // MAIN SPAWN METHODS
    // ========================================

    /**
     * Generate a new entity with random attributes and trait selection.
     *
     * This is the core generation method that:
     * 1. Rolls attributes within configured ranges
     * 2. Initializes variables with default values
     * 3. Selects traits from layers based on weights and eligibility
     * 4. Checks compound conditions
     * 5. Calculates derived values
     *
     * @param {Object} [overrides={}] - Optional overrides for generation
     * @param {string} [overrides.id] - Custom entity ID (default: auto-generated)
     * @param {Object} [overrides.attributes] - Attribute value overrides
     * @param {Object} [overrides.contexts] - Context value overrides
     * @param {string[]} [overrides.forceTraits] - Trait IDs to force-activate
     * @returns {Object} The generated entity object
     * @example
     * // Basic random generation
     * const entity = manager.generate();
     *
     * @example
     * // Generation with attribute overrides
     * const strong = manager.generate({
     *   attributes: { attr_strength: 10 }
     * });
     *
     * @example
     * // Force specific traits
     * const warrior = manager.generate({
     *   forceTraits: ['trait_warrior', 'trait_brave']
     * });
     */
    generate(overrides = {}) {
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
            actions: {},  // Action cooldown state
            _internal: {
                log: [],
                lastTick: Date.now()
            }
        };

        // Initialize variables first (they don't depend on spawn order)
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

        // Initialize contexts (they don't depend on spawn order)
        for (const ctx of this.getContexts()) {
            entity.contexts[ctx.id] = overrides.contexts?.[ctx.id] ?? ctx.config.default;
        }

        // Initialize all layer containers (needed before any rolls)
        for (const layer of this.getLayers()) {
            entity.layers[layer.id] = { active: [], lastRoll: null };
        }

        // Process spawnable nodes in spawn order
        // This allows traits that spawn early to influence attributes that spawn later
        const spawnOrder = this.getSpawnOrder();

        for (const item of spawnOrder) {
            if (item.type === 'attribute') {
                const attr = item.node;
                // Check if this attribute has an override
                if (overrides.attributes?.[attr.id] !== undefined) {
                    entity.attributes[attr.id] = overrides.attributes[attr.id];
                } else {
                    // Get range modified by any active traits
                    const range = this.getModifiedAttributeRange(entity, attr);
                    entity.attributes[attr.id] = this.rollRange(range.min, range.max, attr.config.precision);
                }
            } else if (item.type === 'layer') {
                const layer = item.node;
                const initialRolls = layer.config.selection?.initialRolls || 1;
                for (let i = 0; i < initialRolls; i++) {
                    this.rollLayer(entity, layer.id);
                }
            }
        }

        // Apply any remaining attribute overrides that weren't in spawn order
        // (for attributes that might not exist in config but are passed as overrides)
        if (overrides.attributes) {
            for (const [attrId, value] of Object.entries(overrides.attributes)) {
                if (entity.attributes[attrId] === undefined) {
                    entity.attributes[attrId] = value;
                }
            }
        }

        this.checkCompounds(entity);
        this.calculateDerived(entity);
        this.recalculateRates(entity);

        // Initialize action cooldowns
        for (const action of this.getActions()) {
            entity.actions[action.id] = { cooldownRemaining: 0 };
        }

        this.log(entity, 'generated', { overrides });
        return entity;
    }

    spawn(presetId, overrides = {}) {
        if (!this.entityManager) {
            console.warn('SpawnManager: No EntityManager linked, cannot spawn presets');
            return null;
        }

        const preset = this.entityManager.getPreset(presetId);
        if (!preset) {
            console.warn(`SpawnManager: Preset '${presetId}' not found`);
            return null;
        }

        const merged = {
            ...overrides,
            attributes: {
                ...this.resolvePresetAttributes(preset.attributes),
                ...this.resolvePresetAttributes(overrides.attributes)
            },
            contexts: { ...preset.contexts, ...overrides.contexts },
            forceTraits: [
                ...(preset.forceTraits || []),           // Legacy flat array
                ...this.resolvePresetTraits(preset.traits),  // New structured traits
                ...(overrides.forceTraits || []),
                ...this.resolvePresetTraits(overrides.traits)
            ]
        };

        const entity = this.generate(merged);

        for (const traitId of merged.forceTraits) {
            this.forceActivateTrait(entity, traitId);
        }

        entity.presetId = presetId;
        entity.name = overrides.name || preset.name;

        this.log(entity, 'spawned', { presetId, overrides });
        return entity;
    }

    spawnWhere(query, overrides = {}) {
        if (query.conditions && !this.evaluateSpawnConditions(query.conditions)) {
            return null;
        }

        if (query.preset) {
            return this.spawn(query.preset, overrides);
        }

        if (query.fromGroup && this.entityManager) {
            const group = this.entityManager.getGroup(query.fromGroup);
            if (!group || group.length === 0) return null;

            let candidates = group;
            if (query.where) {
                candidates = group.filter(e => this.matchesWhere(e, query.where));
            }
            if (candidates.length === 0) return null;

            const pick = query.pick || 'random';
            let selected;

            if (pick === 'random') {
                selected = candidates[Math.floor(Math.random() * candidates.length)];
            } else if (pick === 'first') {
                selected = candidates[0];
            } else if (pick === 'weighted' && query.weightBy) {
                selected = this.weightedPick(candidates, query.weightBy);
            }

            return this.cloneEntity(selected, overrides);
        }

        if (query.withTraits || query.withAttributes) {
            const entity = this.generate(overrides);
            if (query.withTraits) {
                for (const traitId of query.withTraits) {
                    this.forceActivateTrait(entity, traitId);
                }
            }
            return entity;
        }

        return this.generate(overrides);
    }

    evaluateSpawnConditions(conditions) {
        const context = this.entityManager?.getSpawnContext() || {};
        return this.evaluateConditionSet(conditions, context);
    }

    evaluateConditionSet(conditions, context) {
        if (!conditions) return true;
        if (conditions.all) {
            return conditions.all.every(c => this.evaluateConditionSet(c, context));
        }
        if (conditions.any) {
            return conditions.any.some(c => this.evaluateConditionSet(c, context));
        }
        if (conditions.not) {
            return !this.evaluateConditionSet(conditions.not, context);
        }

        const { target, operator, value } = conditions;
        const actual = this.getNestedValue(context, target);
        return this.compareValues(actual, operator, value);
    }

    matchesWhere(entity, where) {
        for (const [path, condition] of Object.entries(where)) {
            const actual = this.getNestedValue(entity, path);
            if (typeof condition === 'object') {
                for (const [op, value] of Object.entries(condition)) {
                    if (!this.compareValues(actual, op, value)) return false;
                }
            } else {
                if (actual !== condition) return false;
            }
        }
        return true;
    }

    getNestedValue(obj, path) {
        return path.split('.').reduce((curr, key) => curr?.[key], obj);
    }

    weightedPick(candidates, weightBy) {
        const weights = candidates.map(c => this.getNestedValue(c, weightBy) || 1);
        const total = weights.reduce((a, b) => a + b, 0);
        let roll = Math.random() * total;
        for (let i = 0; i < candidates.length; i++) {
            roll -= weights[i];
            if (roll <= 0) return candidates[i];
        }
        return candidates[0];
    }

    cloneEntity(entity, overrides = {}) {
        const clone = JSON.parse(JSON.stringify(entity));
        clone.id = `entity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        clone.createdAt = Date.now();
        clone.clonedFrom = entity.id;
        if (overrides.attributes) Object.assign(clone.attributes, overrides.attributes);
        if (overrides.contexts) Object.assign(clone.contexts, overrides.contexts);
        return clone;
    }

    // ========================================
    // LAYER SELECTION
    // ========================================

    rollLayer(entity, layerId) {
        const layer = this.getNode(layerId);
        if (!layer || layer.type !== 'layer') {
            return { success: false, error: 'Invalid layer' };
        }

        const selection = layer.config.selection || {};
        const mode = selection.mode || 'weighted';
        const maxItems = selection.maxItems ?? 10;

        const currentActive = entity.layers[layerId]?.active || [];
        if (currentActive.length >= maxItems) {
            return { success: false, error: 'Layer at capacity', maxItems };
        }

        let result;
        switch (mode) {
            case 'weighted': result = this.selectWeighted(entity, layerId); break;
            case 'allMatching': result = this.selectAllMatching(entity, layerId); break;
            case 'pickN': result = this.selectPickN(entity, layerId, selection.pickCount || 1); break;
            case 'firstMatch': result = this.selectFirstMatch(entity, layerId); break;
            default: result = this.selectWeighted(entity, layerId);
        }

        if (result.selected && result.selected.length > 0) {
            for (const traitId of result.selected) {
                this.activateTrait(entity, traitId);
            }
            entity.layers[layerId].lastRoll = Date.now();
        }

        return result;
    }

    /**
     * Roll an outcome layer - clears previous results and rolls fresh.
     * Use for layers with timing.rollAt = 'manual', like attack/defense outcomes.
     * @param {Object} entity - The entity to roll for
     * @param {string} layerId - The layer to roll
     * @param {number} [rolls=1] - Number of times to roll
     * @returns {Object} Result with selected items
     */
    rollOutcome(entity, layerId, rolls = 1) {
        const layer = this.getNode(layerId);
        if (!layer || layer.type !== 'layer') {
            return { success: false, error: 'Invalid layer' };
        }

        // Ensure the entity has this layer initialized
        if (!entity.layers[layerId]) {
            entity.layers[layerId] = { active: [], lastRoll: null };
        }

        // Clear previous active items from this layer
        const previousActive = [...(entity.layers[layerId].active || [])];
        for (const traitId of previousActive) {
            this.deactivateTrait(entity, traitId);
        }
        entity.layers[layerId].active = [];

        // Roll fresh
        const allSelected = [];
        for (let i = 0; i < rolls; i++) {
            const result = this.rollLayer(entity, layerId);
            if (result.success && result.selected) {
                allSelected.push(...result.selected);
            }
        }

        this.checkCompounds(entity);
        this.calculateDerived(entity);

        return {
            success: allSelected.length > 0,
            selected: allSelected,
            previousActive,
            layerId
        };
    }

    selectWeighted(entity, layerId) {
        const traits = this.getLayerTraits(layerId);
        const currentActive = new Set(entity.layers[layerId]?.active || []);

        const pool = [];
        for (const trait of traits) {
            if (currentActive.has(trait.id)) continue;
            if (trait.config.selection?.mode === 'threshold') continue;
            if (!this.checkEligibility(entity, trait)) continue;
            if (this.hasIncompatibility(entity, trait)) continue;

            const weight = this.calculateWeight(entity, trait);
            if (weight > 0) pool.push({ trait, weight });
        }

        if (pool.length === 0) {
            return { success: false, error: 'No eligible traits', pool: [] };
        }

        const totalWeight = pool.reduce((sum, p) => sum + p.weight, 0);
        let roll = Math.random() * totalWeight;

        for (const { trait, weight } of pool) {
            roll -= weight;
            if (roll <= 0) {
                return {
                    success: true,
                    selected: [trait.id],
                    pool: pool.map(p => ({ id: p.trait.id, weight: p.weight }))
                };
            }
        }

        return { success: true, selected: [pool[0].trait.id], pool };
    }

    selectAllMatching(entity, layerId) {
        const traits = this.getLayerTraits(layerId);
        const currentActive = new Set(entity.layers[layerId]?.active || []);
        const selected = [];

        for (const trait of traits) {
            if (currentActive.has(trait.id)) continue;
            if (!this.checkEligibility(entity, trait)) continue;
            if (this.hasIncompatibility(entity, trait)) continue;
            selected.push(trait.id);
        }

        return { success: true, selected };
    }

    selectPickN(entity, layerId, n) {
        const result = this.selectWeighted(entity, layerId);
        if (!result.pool || result.pool.length === 0) {
            return { success: false, error: 'No eligible traits' };
        }

        const selected = [];
        const remainingPool = [...result.pool];

        for (let i = 0; i < n && remainingPool.length > 0; i++) {
            const totalWeight = remainingPool.reduce((sum, p) => sum + p.weight, 0);
            let roll = Math.random() * totalWeight;

            for (let j = 0; j < remainingPool.length; j++) {
                roll -= remainingPool[j].weight;
                if (roll <= 0) {
                    selected.push(remainingPool[j].id);
                    remainingPool.splice(j, 1);
                    break;
                }
            }
        }

        return { success: true, selected };
    }

    selectFirstMatch(entity, layerId) {
        const traits = this.getLayerTraits(layerId);
        const currentActive = new Set(entity.layers[layerId]?.active || []);

        for (const trait of traits) {
            if (currentActive.has(trait.id)) continue;
            if (!this.checkEligibility(entity, trait)) continue;
            if (this.hasIncompatibility(entity, trait)) continue;
            return { success: true, selected: [trait.id] };
        }

        return { success: false, error: 'No matching traits' };
    }

    // ========================================
    // WEIGHT & ELIGIBILITY
    // ========================================

    calculateWeight(entity, trait) {
        const selection = trait.config.selection || {};
        let weight = selection.baseWeight ?? 20;
        const baseWeight = weight;

        // Get layer config for diminishing returns / weight floor
        const layerNode = trait.config.layerId ? this.getNode(trait.config.layerId) : null;
        const layerSelection = layerNode?.config?.selection || {};
        const useDR = layerSelection.diminishingReturns === true;

        for (const mod of selection.weightModifiers || []) {
            if (this.evaluateCondition(entity, mod.condition)) {
                if (mod.operation === 'add') {
                    let effect = mod.value;
                    if (useDR && effect !== 0) {
                        effect = Math.sign(effect) * Math.sqrt(Math.abs(effect)) * Math.sqrt(baseWeight);
                    }
                    weight += effect;
                } else if (mod.operation === 'multiply') {
                    weight *= mod.value;
                }
            }
        }

        const influences = this.getRelationshipsTo(trait.id)
            .filter(r => r.type === 'weight_influence');

        for (const rel of influences) {
            if (!this.isNodeActive(entity, rel.sourceId)) continue;
            if (!this.evaluateConditions(entity, rel.conditions)) continue;

            let value = this.calculateRelationshipValue(entity, rel);
            if (rel.config.operation === 'add') {
                if (useDR && value !== 0) {
                    value = Math.sign(value) * Math.sqrt(Math.abs(value)) * Math.sqrt(baseWeight);
                }
                weight += value;
            } else if (rel.config.operation === 'multiply') {
                weight *= value;
            }
        }

        const weightFloor = layerSelection.weightFloor ?? 0;
        return Math.max(weightFloor, weight);
    }

    calculateRelationshipValue(entity, rel) {
        let value = rel.config.value;
        if (rel.config.scaling === 'perPoint' && rel.config.perPointSource) {
            let sourceValue = this.getNodeValue(entity, rel.config.perPointSource);

            // Invert: use (max - value) instead of value directly
            // Useful for "low sociability = high introvert chance" type relationships
            if (rel.config.invert) {
                const sourceNode = this.getNode(rel.config.perPointSource);
                const max = sourceNode?.config?.max ?? 10;
                sourceValue = max - sourceValue;
            }

            value = value * sourceValue;
        }
        return value;
    }

    checkEligibility(entity, trait) {
        const eligibility = trait.config.eligibility || [];
        return this.evaluateConditions(entity, eligibility);
    }

    hasIncompatibility(entity, trait) {
        const incompatible = trait.config.incompatibleWith || [];
        for (const incompId of incompatible) {
            if (this.isNodeActive(entity, incompId)) return true;
        }
        return false;
    }

    // ========================================
    // TRAIT ACTIVATION
    // ========================================

    activateTrait(entity, traitId) {
        const trait = this.getNode(traitId);
        if (!trait || !this.isTrait(trait)) return false;

        const layerId = trait.config.layerId;
        if (!entity.layers[layerId]) {
            entity.layers[layerId] = { active: [], lastRoll: null };
        }

        if (entity.layers[layerId].active.includes(traitId)) return false;

        const replaces = trait.config.selection?.replaces || [];
        for (const replaceId of replaces) {
            this.deactivateTrait(entity, replaceId);
        }

        entity.layers[layerId].active.push(traitId);
        this.log(entity, 'traitActivated', { traitId, layerId });
        return true;
    }

    // Backward compatibility
    activateItem(entity, itemId) { return this.activateTrait(entity, itemId); }

    forceActivateTrait(entity, traitId) {
        const trait = this.getNode(traitId);
        if (!trait || !this.isTrait(trait)) return false;

        const layerId = trait.config.layerId;
        if (!entity.layers[layerId]) {
            entity.layers[layerId] = { active: [], lastRoll: null };
        }

        if (!entity.layers[layerId].active.includes(traitId)) {
            entity.layers[layerId].active.push(traitId);
        }
        return true;
    }

    deactivateTrait(entity, traitId) {
        const trait = this.getNode(traitId);
        if (!trait || !this.isTrait(trait)) return false;

        const layerId = trait.config.layerId;
        if (!entity.layers[layerId]) return false;

        const index = entity.layers[layerId].active.indexOf(traitId);
        if (index === -1) return false;

        entity.layers[layerId].active.splice(index, 1);
        return true;
    }

    // Backward compatibility
    deactivateItem(entity, itemId) { return this.deactivateTrait(entity, itemId); }

    // ========================================
    // COMPOUNDS & DERIVED
    // ========================================

    checkCompounds(entity) {
        for (const compound of this.getCompounds()) {
            const isActive = entity.compounds.includes(compound.id);
            const requirementsMet = this.checkCompoundRequirements(entity, compound);

            if (requirementsMet && !isActive) {
                entity.compounds.push(compound.id);
            } else if (!requirementsMet && isActive) {
                const index = entity.compounds.indexOf(compound.id);
                if (index > -1) entity.compounds.splice(index, 1);
            }
        }
    }

    checkCompoundRequirements(entity, compound) {
        const requires = compound.config.requires || [];
        const logic = compound.config.requirementLogic || 'all';

        if (requires.length === 0) return false;

        const results = requires.map(req => {
            // Handle string format (just node ID)
            if (typeof req === 'string') {
                return this.isNodeActive(entity, req);
            }

            // Handle threshold condition (object with id + operator + value)
            if (req.id && req.operator && req.value !== undefined) {
                const nodeValue = this.getNodeValue(entity, req.id);
                if (nodeValue === null || nodeValue === undefined) return false;
                return this.compareValues(nodeValue, req.operator, req.value);
            }

            // Handle legacy object formats
            if (req.item || req.trait) {
                return this.isNodeActive(entity, req.item || req.trait);
            } else if (req.modifier) {
                return entity.modifiers.includes(req.modifier);
            } else if (req.condition) {
                return this.evaluateCondition(entity, req.condition);
            } else if (req.id) {
                // Simple object with just id (no threshold)
                return this.isNodeActive(entity, req.id);
            }
            return false;
        });

        return logic === 'all' ? results.every(r => r) : results.some(r => r);
    }

    /**
     * Get the current numeric value of a node (attribute or variable).
     * @param {Object} entity - The entity to check
     * @param {string} nodeId - The node ID to get value from
     * @returns {number|null} The current value, or null if not found
     */
    getNodeValue(entity, nodeId) {
        // Check attributes
        if (entity.attributes && entity.attributes[nodeId] !== undefined) {
            return entity.attributes[nodeId];
        }
        // Check variables
        if (entity.variables && entity.variables[nodeId]) {
            return entity.variables[nodeId].value;
        }
        // Check derived
        if (entity.derived && entity.derived[nodeId] !== undefined) {
            return entity.derived[nodeId];
        }
        return null;
    }

    /**
     * Compare two values using a comparison operator.
     * @param {number} a - Left operand
     * @param {string} operator - Comparison operator (<, <=, >, >=, =)
     * @param {number} b - Right operand
     * @returns {boolean} Result of comparison
     */
    compareValues(a, operator, b) {
        switch (operator) {
            case '<': return a < b;
            case '<=': return a <= b;
            case '>': return a > b;
            case '>=': return a >= b;
            case '=':
            case '==':
            case '===': return a === b;
            default: return false;
        }
    }

    calculateDerived(entity) {
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

                const value = this.evaluateFormula(formula, context);
                entity.derived[derived.id] = Math.max(
                    cfg.min ?? -Infinity,
                    Math.min(cfg.max ?? Infinity, value)
                );
            } catch (e) {
                entity.derived[derived.id] = 0;
            }
        }
    }

    recalculateRates(entity) {
        for (const varNode of this.getVariables()) {
            const varState = entity.variables[varNode.id];
            if (!varState) continue;

            let rate = varState.baseRate;

            const rateRels = this.getRelationshipsTo(varNode.id)
                .filter(r => r.type === 'rate_modifier');

            for (const rel of rateRels) {
                if (!this.isNodeActive(entity, rel.sourceId)) continue;
                if (!this.evaluateConditions(entity, rel.conditions)) continue;

                const value = this.calculateRelationshipValue(entity, rel);
                if (rel.config.operation === 'add') rate += value;
                else if (rel.config.operation === 'multiply') rate *= value;
            }

            varState.currentRate = rate;
        }
    }

    // ========================================
    // CONDITION EVALUATION
    // ========================================

    evaluateConditions(entity, conditions) {
        if (!conditions || conditions.length === 0) return true;
        return conditions.every(cond => this.evaluateCondition(entity, cond));
    }

    evaluateCondition(entity, condition) {
        if (!condition) return true;

        if (condition.all) {
            return condition.all.every(c => this.evaluateCondition(entity, c));
        }
        if (condition.any) {
            return condition.any.some(c => this.evaluateCondition(entity, c));
        }
        if (condition.not) {
            return !this.evaluateCondition(entity, condition.not);
        }

        const { type, target, operator, value } = condition;
        let actualValue;

        switch (type) {
            case 'attribute': actualValue = entity.attributes[target]; break;
            case 'variable': actualValue = entity.variables[target]?.value; break;
            case 'context': actualValue = entity.contexts[target]; break;
            case 'trait':
            case 'item':
                return this.isNodeActive(entity, target);
            case 'modifier': return entity.modifiers.includes(target);
            case 'compound': return entity.compounds.includes(target);
            default: return false;
        }

        return this.compareValues(actualValue, operator, value);
    }

    compareValues(actual, operator, expected) {
        switch (operator) {
            case '<': case 'lt': return actual < expected;
            case '<=': case 'lte': return actual <= expected;
            case '>': case 'gt': return actual > expected;
            case '>=': case 'gte': return actual >= expected;
            case '==': case 'eq': return actual == expected;
            case '===': return actual === expected;
            case '!=': case 'ne': return actual != expected;
            case '!==': return actual !== expected;
            case 'in': return Array.isArray(expected) && expected.includes(actual);
            case 'includes': return Array.isArray(actual) && actual.includes(expected);
            default: return false;
        }
    }

    // ========================================
    // NODE STATE HELPERS
    // ========================================

    getNodeValue(entity, nodeId) {
        const node = this.getNode(nodeId);
        if (!node) return 0;

        switch (node.type) {
            case 'attribute': return entity.attributes[nodeId] ?? 0;
            case 'variable': return entity.variables[nodeId]?.value ?? 0;
            case 'context': return entity.contexts[nodeId] ?? 0;
            default: return 0;
        }
    }

    isNodeActive(entity, nodeId) {
        const node = this.getNode(nodeId);
        if (!node) return false;

        if (this.isTrait(node)) {
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

    // ========================================
    // UTILITIES
    // ========================================

    rollRange(min, max, precision = 0) {
        const value = min + Math.random() * (max - min);
        if (precision === 0) return Math.round(value);
        const factor = Math.pow(10, precision);
        return Math.round(value * factor) / factor;
    }

    /**
     * Resolve a preset attribute value to a concrete number.
     * Supports fixed values, min/max ranges, and base +/- variance.
     *
     * @param {number|Object} attrValue - The attribute specification
     * @param {number} [precision=0] - Decimal precision
     * @returns {number} Resolved value
     * @example
     * // Fixed value
     * resolvePresetAttributeValue(6) // => 6
     *
     * // Min/max range (uniform random)
     * resolvePresetAttributeValue({ min: 5, max: 10 }) // => 5-10
     *
     * // Base with variance
     * resolvePresetAttributeValue({ base: 50, variance: 10 }) // => 40-60
     */
    resolvePresetAttributeValue(attrValue, precision = 0) {
        if (typeof attrValue === 'number') {
            return attrValue;  // Fixed value
        }
        if (typeof attrValue === 'object' && attrValue !== null) {
            // Min/max range
            if (attrValue.min !== undefined && attrValue.max !== undefined) {
                return this.rollRange(attrValue.min, attrValue.max, precision);
            }
            // Base with variance
            if (attrValue.base !== undefined) {
                const variance = attrValue.variance || 0;
                return this.rollRange(attrValue.base - variance, attrValue.base + variance, precision);
            }
            // Object with just 'value' property (explicit fixed)
            if (attrValue.value !== undefined) {
                return attrValue.value;
            }
        }
        return 0;  // Fallback
    }

    /**
     * Resolve all preset attribute values to concrete numbers.
     *
     * @param {Object} attributes - Map of attributeId to value specification
     * @returns {Object} Map of attributeId to resolved numeric values
     */
    resolvePresetAttributes(attributes) {
        if (!attributes) return {};
        const resolved = {};
        for (const [attrId, value] of Object.entries(attributes)) {
            const attrNode = this.getNode(attrId);
            const precision = attrNode?.config?.precision ?? 0;
            resolved[attrId] = this.resolvePresetAttributeValue(value, precision);
        }
        return resolved;
    }

    /**
     * Resolve preset trait selections to concrete trait IDs.
     * Supports multiple selection modes per layer.
     *
     * @param {Object} traits - Map of layerId to trait selection specification
     * @returns {string[]} Array of trait IDs to force-activate
     * @example
     * // String: always force
     * resolvePresetTraits({ layer_race: 'item_humanoid' })
     *
     * // Weighted pool
     * resolvePresetTraits({
     *   layer_behavior: {
     *     mode: 'weighted',
     *     pool: [{ id: 'item_aggressive', weight: 70 }, { id: 'item_tactical', weight: 30 }]
     *   }
     * })
     *
     * // Chance-based
     * resolvePresetTraits({
     *   layer_resistance: { mode: 'chance', chance: 0.3, pool: ['item_fire_resist'] }
     * })
     *
     * // Pick N
     * resolvePresetTraits({
     *   layer_skills: { mode: 'pickN', count: 2, pool: ['skill_a', 'skill_b', 'skill_c'] }
     * })
     */
    resolvePresetTraits(traits) {
        if (!traits) return [];
        const resolved = [];

        for (const [layerId, spec] of Object.entries(traits)) {
            // String: always force this trait
            if (typeof spec === 'string') {
                resolved.push(spec);
                continue;
            }

            // Array: force all traits in array
            if (Array.isArray(spec)) {
                resolved.push(...spec);
                continue;
            }

            // Object: mode-based selection
            if (typeof spec === 'object' && spec !== null) {
                const mode = spec.mode || 'weighted';
                let pool = spec.pool || [];

                // If taxonomyFilter is specified, build pool from matching nodes
                if (spec.taxonomyFilter && Object.keys(spec.taxonomyFilter).length > 0) {
                    const matchingNodes = this.getNodesByTaxonomy(spec.taxonomyFilter);
                    // Filter to only items/traits that belong to this layer
                    const layer = this.getNode(layerId);
                    const layerItemIds = new Set(layer?.config?.itemIds || layer?.config?.traitIds || []);
                    pool = matchingNodes
                        .filter(n => layerItemIds.has(n.id))
                        .map(n => ({ id: n.id, weight: n.config?.selection?.baseWeight || 1 }));
                }

                if (pool.length === 0) continue;

                switch (mode) {
                    case 'weighted': {
                        const picked = this.selectWeightedFromPool(pool);
                        if (picked) resolved.push(picked);
                        break;
                    }

                    case 'chance': {
                        const chance = spec.chance ?? 0.5;
                        if (Math.random() < chance) {
                            // Pick one randomly from pool
                            const idx = Math.floor(Math.random() * pool.length);
                            const item = pool[idx];
                            resolved.push(typeof item === 'string' ? item : item.id);
                        }
                        break;
                    }

                    case 'pickN': {
                        const count = spec.count ?? 1;
                        const picks = this.selectNFromPool(pool, count);
                        resolved.push(...picks);
                        break;
                    }

                    case 'all': {
                        // Force all traits in pool
                        for (const item of pool) {
                            resolved.push(typeof item === 'string' ? item : item.id);
                        }
                        break;
                    }

                    default:
                        // Unknown mode, treat as weighted
                        const picked = this.selectWeightedFromPool(pool);
                        if (picked) resolved.push(picked);
                }
            }
        }

        return resolved;
    }

    /**
     * Select one item from a weighted pool.
     *
     * @param {Array} pool - Array of items (strings or {id, weight} objects)
     * @returns {string|null} Selected item ID or null if pool is empty
     */
    selectWeightedFromPool(pool) {
        if (!pool || pool.length === 0) return null;

        const total = pool.reduce((sum, item) => {
            const weight = typeof item === 'string' ? 1 : (item.weight ?? 1);
            return sum + weight;
        }, 0);

        let roll = Math.random() * total;

        for (const item of pool) {
            const weight = typeof item === 'string' ? 1 : (item.weight ?? 1);
            roll -= weight;
            if (roll <= 0) {
                return typeof item === 'string' ? item : item.id;
            }
        }

        // Fallback to first item
        const first = pool[0];
        return typeof first === 'string' ? first : first.id;
    }

    /**
     * Select N items from a weighted pool without replacement.
     *
     * @param {Array} pool - Array of items (strings or {id, weight} objects)
     * @param {number} n - Number of items to select
     * @returns {string[]} Array of selected item IDs
     */
    selectNFromPool(pool, n) {
        if (!pool || pool.length === 0) return [];

        const remaining = [...pool];
        const picks = [];

        for (let i = 0; i < n && remaining.length > 0; i++) {
            const total = remaining.reduce((sum, item) => {
                const weight = typeof item === 'string' ? 1 : (item.weight ?? 1);
                return sum + weight;
            }, 0);

            let roll = Math.random() * total;

            for (let j = 0; j < remaining.length; j++) {
                const item = remaining[j];
                const weight = typeof item === 'string' ? 1 : (item.weight ?? 1);
                roll -= weight;
                if (roll <= 0) {
                    const picked = remaining.splice(j, 1)[0];
                    picks.push(typeof picked === 'string' ? picked : picked.id);
                    break;
                }
            }
        }

        return picks;
    }

    evaluateFormula(formula, context) {
        const keys = Object.keys(context);
        const values = Object.values(context);

        let cached = this._formulaCache.get(formula);
        if (!cached || cached.keys.length !== keys.length || !cached.keys.every((k, i) => k === keys[i])) {
            const fn = new Function(...keys, `return ${formula}`);
            cached = { fn, keys: [...keys] };
            this._formulaCache.set(formula, cached);
        }

        return cached.fn(...values);
    }

    // ========================================
    // ACTION SYSTEM
    // ========================================

    /**
     * Check if an action is available for an entity.
     *
     * @param {Object} entity - The entity
     * @param {string} actionId - The action ID
     * @returns {boolean} True if action can be used
     */
    isActionAvailable(entity, actionId) {
        const action = this.getNode(actionId);
        if (!action || action.type !== 'action') return false;

        const cfg = action.config || {};

        // Check cooldown
        if (entity.actions?.[actionId]?.cooldownRemaining > 0) return false;

        // Check costs (can afford?)
        for (const [varId, cost] of Object.entries(cfg.costs || {})) {
            const varState = entity.variables[varId];
            if (!varState || varState.value < cost) return false;
        }

        // Check requirements (traits that must be active)
        for (const reqId of cfg.requirements || []) {
            if (!this.isNodeActive(entity, reqId)) return false;
        }

        // Check blockedBy (traits that prevent use)
        for (const blockId of cfg.blockedBy || []) {
            if (this.isNodeActive(entity, blockId)) return false;
        }

        // Check eligibility conditions
        if (cfg.eligibility && !this.evaluateConditions(entity, cfg.eligibility)) {
            return false;
        }

        return true;
    }

    /**
     * Get all available actions for an entity with calculated weights.
     *
     * @param {Object} entity - The entity
     * @returns {Array<{id: string, weight: number, action: Object}>} Available actions
     */
    getAvailableActions(entity) {
        const available = [];

        for (const action of this.getActions()) {
            if (!this.isActionAvailable(entity, action.id)) continue;

            let weight = action.config?.baseWeight ?? 50;

            // Apply preset action weights if entity has preset
            if (entity.presetId && this.entityManager) {
                const preset = this.entityManager.getPreset(entity.presetId);
                if (preset?.actions?.[action.id]) {
                    const presetAction = preset.actions[action.id];
                    if (typeof presetAction === 'number') {
                        weight = presetAction;
                    } else if (presetAction.weight !== undefined) {
                        // Check condition if specified
                        if (presetAction.condition) {
                            if (this.evaluateCondition(entity, presetAction.condition)) {
                                weight = presetAction.weight;
                            }
                        } else {
                            weight = presetAction.weight;
                        }
                    }
                }
            }

            // Apply relationship weight modifiers
            const influences = this.getRelationshipsTo(action.id)
                .filter(r => r.type === 'weight_influence');
            for (const rel of influences) {
                if (!this.isNodeActive(entity, rel.sourceId)) continue;
                if (!this.evaluateConditions(entity, rel.conditions)) continue;

                const value = this.calculateRelationshipValue(entity, rel);
                if (rel.config.operation === 'add') weight += value;
                else if (rel.config.operation === 'multiply') weight *= value;
            }

            if (weight > 0) {
                available.push({ id: action.id, weight, action });
            }
        }

        return available;
    }

    /**
     * Select an action using weighted random selection.
     *
     * @param {Object} entity - The entity
     * @returns {Object|null} Selected action {id, weight, action} or null
     */
    selectAction(entity) {
        const available = this.getAvailableActions(entity);
        if (available.length === 0) return null;

        const total = available.reduce((sum, a) => sum + a.weight, 0);
        let roll = Math.random() * total;

        for (const a of available) {
            roll -= a.weight;
            if (roll <= 0) return a;
        }

        return available[0];
    }

    /**
     * Execute an action, deducting costs and starting cooldown.
     *
     * @param {Object} entity - The entity
     * @param {string} actionId - The action ID
     * @returns {Object} Result {success, actionId, effects, action} or {success: false, reason}
     */
    executeAction(entity, actionId) {
        if (!this.isActionAvailable(entity, actionId)) {
            return { success: false, reason: 'Action not available' };
        }

        const action = this.getNode(actionId);
        const cfg = action.config || {};

        // Deduct costs
        for (const [varId, cost] of Object.entries(cfg.costs || {})) {
            if (entity.variables[varId]) {
                entity.variables[varId].value = Math.max(
                    entity.variables[varId].min,
                    entity.variables[varId].value - cost
                );
            }
        }

        // Start cooldown
        if (!entity.actions) entity.actions = {};
        if (!entity.actions[actionId]) entity.actions[actionId] = {};
        entity.actions[actionId].cooldownRemaining = cfg.cooldown || 0;

        this.log(entity, 'actionExecuted', { actionId });

        // Return action data for game code to handle effects
        return {
            success: true,
            actionId,
            effects: cfg.effects || {},
            action
        };
    }

    /**
     * Get action cooldown status for an entity.
     *
     * @param {Object} entity - The entity
     * @param {string} actionId - The action ID
     * @returns {Object} {cooldownRemaining, cooldownTotal, ready}
     */
    getActionCooldown(entity, actionId) {
        const action = this.getNode(actionId);
        const cooldownTotal = action?.config?.cooldown || 0;
        const cooldownRemaining = entity.actions?.[actionId]?.cooldownRemaining || 0;

        return {
            cooldownRemaining,
            cooldownTotal,
            ready: cooldownRemaining <= 0
        };
    }

    log(entity, event, data = {}) {
        entity._internal.log.push({ timestamp: Date.now(), event, data });
        if (entity._internal.log.length > 1000) {
            entity._internal.log = entity._internal.log.slice(-500);
        }
    }

    // ========================================
    // ANALYSIS (for editor)
    // ========================================

    getWeights(entity, layerId) {
        const traits = this.getLayerTraits(layerId);
        const currentActive = new Set(entity?.layers[layerId]?.active || []);

        const result = [];
        for (const trait of traits) {
            const isActive = currentActive.has(trait.id);
            const isThreshold = trait.config.selection?.mode === 'threshold';
            const isEligible = entity ? this.checkEligibility(entity, trait) : true;
            const hasIncompat = entity ? this.hasIncompatibility(entity, trait) : false;
            const weight = entity ? this.calculateWeight(entity, trait) : trait.config.selection?.baseWeight ?? 20;

            result.push({
                id: trait.id,
                name: trait.name,
                isActive, isThreshold, isEligible, hasIncompat, weight,
                baseWeight: trait.config.selection?.baseWeight ?? 20
            });
        }

        const eligibleWeight = result
            .filter(r => !r.isActive && !r.isThreshold && r.isEligible && !r.hasIncompat && r.weight > 0)
            .reduce((sum, r) => sum + r.weight, 0);

        for (const r of result) {
            r.percentage = eligibleWeight > 0 ? (r.weight / eligibleWeight) * 100 : 0;
        }

        return result;
    }

    previewInfluences(nodeId) {
        const incoming = this.getRelationshipsTo(nodeId);
        const outgoing = this.getRelationshipsFrom(nodeId);

        return {
            incoming: incoming.map(r => ({
                ...r,
                sourceName: this.getNode(r.sourceId)?.name || r.sourceId
            })),
            outgoing: outgoing.map(r => ({
                ...r,
                targetName: this.getNode(r.targetId)?.name || r.targetId
            }))
        };
    }
}


// ============================================================================
// ENTITY MANAGER - Storage & Runtime State
// ============================================================================

/**
 * Runtime state manager for entities.
 * Handles storage, activation, ticking, modifiers, and events.
 * Works with SpawnManager for generation or can be used standalone.
 *
 * @class EntityManager
 * @fires EntityManager#variableChanged - When a variable value changes
 * @fires EntityManager#modifierApplied - When a modifier is applied
 * @fires EntityManager#modifierRemoved - When a modifier is removed
 * @fires EntityManager#compoundActivated - When a compound becomes active
 * @fires EntityManager#compoundDeactivated - When a compound becomes inactive
 * @fires EntityManager#entityStored - When an entity is stored
 * @fires EntityManager#entityActivated - When an entity is activated
 * @fires EntityManager#entityRemoved - When an entity is removed
 * @example
 * const manager = new EntityManager();
 * manager.store(entity);
 * manager.activate(entity.id);
 * manager.tick(entity.id, 1); // Tick for 1 second
 */
class EntityManager {
    /**
     * Create a new EntityManager instance.
     *
     * @param {SpawnManager|null} [spawnManager=null] - SpawnManager to link for generation
     */
    constructor(spawnManager = null) {
        /** @type {SpawnManager|null} Linked SpawnManager */
        this.spawnManager = spawnManager;
        /** @type {Map<string, Object>} Registered presets */
        this.presets = new Map();
        /** @type {Map<string, Object>} Preset groups */
        this.presetGroups = new Map();
        /** @type {Map<string, Object>} Entity groups */
        this.groups = new Map();
        /** @type {Map<string, Object>} All stored entities */
        this.stored = new Map();
        /** @type {Map<string, Object>} Currently active entities */
        this.active = new Map();
        /** @type {Map<string, Array>} Entity state history */
        this.history = new Map();
        /** @type {Object} Global spawn context */
        this.spawnContext = {};
        /** @type {Object} Manager configuration */
        this.config = {
            tickRate: 1000,
            maxHistory: 50,
            maxEntities: null
        };
        /** @type {number|null} Auto-tick interval ID */
        this.tickInterval = null;
        /** @type {Map<string, Set>} Event listeners */
        this.listeners = new Map();
        /** @type {boolean} When true, cascade recalculations are deferred */
        this._batchingCascade = false;
        /** @type {boolean} Dirty flag for deferred cascade */
        this._cascadeDirty = false;
        /** @type {Object|null} Entity reference for deferred cascade */
        this._cascadeEntity = null;

        // ========================================
        // ENTITY POOLING (Multi-Pool System)
        // ========================================

        /** @type {Map<string, Object>} Named pools registry */
        this.pools = new Map();
        /** @type {string} Default pool ID for backward compatibility */
        this.defaultPoolId = 'default';

        // Legacy single-pool references (for backward compatibility)
        // These now proxy to the default pool
        /** @type {Array<Object>} @deprecated Use pools.get('default').entities instead */
        this.pool = [];
        /** @type {Object} @deprecated Use pools.get('default').config instead */
        this.poolConfig = {
            maxSize: 100,
            preWarm: 0,
            preWarmPreset: null,
            shrinkThreshold: 0.5,
            shrinkDelay: 30000
        };
        /** @type {Object} @deprecated Use pools.get('default').stats instead */
        this.poolStats = {
            size: 0,
            available: 0,
            inUse: 0,
            totalAcquired: 0,
            totalReleased: 0,
            totalCreated: 0
        };
        /** @type {number|null} Shrink timeout ID */
        this._shrinkTimeout = null;

        // Initialize default pool
        this._initDefaultPool();
    }

    /**
     * Initialize the default pool for backward compatibility.
     * @private
     */
    _initDefaultPool() {
        this.pools.set(this.defaultPoolId, {
            id: this.defaultPoolId,
            name: 'Default Pool',
            description: 'Default entity pool',
            config: { ...this.poolConfig },
            stats: { ...this.poolStats },
            entities: this.pool, // Share array reference for backward compat
            rules: null, // Default pool catches all unmatched entities
            _shrinkTimeout: null
        });
    }

    /**
     * Link a SpawnManager for generation integration.
     *
     * @param {SpawnManager} spawnManager - The SpawnManager to link
     * @returns {EntityManager} This instance for chaining
     */
    linkSpawnManager(spawnManager) {
        this.spawnManager = spawnManager;
        spawnManager.linkEntityManager(this);
        return this;
    }

    // ========================================
    // PRESETS
    // ========================================

    /**
     * Register a spawn preset template.
     *
     * @param {string} id - Unique preset ID
     * @param {Object} template - Preset template
     * @param {string} [template.name] - Display name
     * @param {Object} [template.attributes] - Attribute overrides
     * @param {string[]} [template.forceTraits] - Traits to force-activate
     * @returns {EntityManager} This instance for chaining
     * @fires EntityManager#presetRegistered
     * @example
     * manager.registerPreset('tavern_regular', {
     *   name: 'Regular Patron',
     *   attributes: { patience: 5 },
     *   forceTraits: ['trait_social']
     * });
     */
    registerPreset(id, template) {
        this.presets.set(id, {
            id,
            name: template.name || id,
            description: template.description || '',
            attributes: template.attributes || {},
            contexts: template.contexts || {},
            forceTraits: template.forceTraits || [],
            tags: template.tags || [],
            ...template
        });
        this.emit('presetRegistered', { id, template });
        return this;
    }

    registerPresets(presets) {
        for (const [id, template] of Object.entries(presets)) {
            this.registerPreset(id, template);
        }
        return this;
    }

    getPreset(id) { return this.presets.get(id) || null; }

    listPresets(filter = null) {
        let presets = Array.from(this.presets.values());
        if (filter) {
            if (filter.group) {
                presets = presets.filter(p => p.group === filter.group);
            }
            if (filter.tags) {
                presets = presets.filter(p => filter.tags.some(tag => p.tags.includes(tag)));
            }
            if (filter.taxonomy) {
                presets = presets.filter(p => {
                    if (!p.taxonomy) return false;
                    return Object.entries(filter.taxonomy).every(([k, v]) => p.taxonomy[k] === v);
                });
            }
            if (filter.search) {
                const search = filter.search.toLowerCase();
                presets = presets.filter(p =>
                    p.name.toLowerCase().includes(search) || p.id.toLowerCase().includes(search)
                );
            }
        }
        return presets;
    }

    /**
     * Get presets matching a taxonomy filter.
     *
     * @param {Object} filter - Taxonomy criteria to match
     * @returns {Array<Object>} Presets matching all criteria
     * @example
     * manager.getPresetsByTaxonomy({ type: 'humanoid' });
     */
    getPresetsByTaxonomy(filter) {
        return this.listPresets({ taxonomy: filter });
    }

    removePreset(id) {
        const existed = this.presets.delete(id);
        if (existed) this.emit('presetRemoved', { id });
        return existed;
    }

    // ========================================
    // PRESET GROUPS
    // ========================================

    registerPresetGroup(id, metadata = {}) {
        this.presetGroups.set(id, {
            id,
            name: metadata.name || id,
            description: metadata.description || ''
        });
        this.emit('presetGroupRegistered', { id, metadata });
        return this;
    }

    getPresetGroup(id) { return this.presetGroups.get(id) || null; }

    listPresetGroups() {
        return Array.from(this.presetGroups.values());
    }

    listPresetsByGroup(groupId) {
        return Array.from(this.presets.values()).filter(p => p.group === groupId);
    }

    removePresetGroup(id) {
        const existed = this.presetGroups.delete(id);
        if (existed) this.emit('presetGroupRemoved', { id });
        return existed;
    }

    // ========================================
    // GROUPS (Entity Groups)
    // ========================================

    createGroup(groupId, metadata = {}) {
        if (!this.groups.has(groupId)) {
            this.groups.set(groupId, {
                id: groupId,
                name: metadata.name || groupId,
                description: metadata.description || '',
                entities: new Set(),
                ...metadata
            });
            this.emit('groupCreated', { groupId, metadata });
        }
        return this;
    }

    addToGroup(groupId, entityId) {
        if (!this.groups.has(groupId)) this.createGroup(groupId);
        this.groups.get(groupId).entities.add(entityId);
        this.emit('addedToGroup', { groupId, entityId });
        return this;
    }

    removeFromGroup(groupId, entityId) {
        const group = this.groups.get(groupId);
        if (group) {
            group.entities.delete(entityId);
            this.emit('removedFromGroup', { groupId, entityId });
        }
        return this;
    }

    getGroup(groupId) {
        const group = this.groups.get(groupId);
        if (!group) return [];
        return Array.from(group.entities)
            .map(id => this.stored.get(id) || this.active.get(id))
            .filter(Boolean);
    }

    getGroupInfo(groupId) { return this.groups.get(groupId) || null; }

    listGroups() {
        return Array.from(this.groups.values()).map(g => ({
            id: g.id, name: g.name, description: g.description, count: g.entities.size
        }));
    }

    deleteGroup(groupId) {
        const existed = this.groups.delete(groupId);
        if (existed) this.emit('groupDeleted', { groupId });
        return existed;
    }

    // ========================================
    // STORAGE
    // ========================================

    store(entity, options = {}) {
        if (this.config.maxEntities !== null && this.stored.size >= this.config.maxEntities) {
            this.emit('storageLimitReached', { limit: this.config.maxEntities });
            return null;
        }

        this.stored.set(entity.id, entity);

        if (options.groups) {
            for (const groupId of options.groups) {
                this.addToGroup(groupId, entity.id);
            }
        }

        if (entity.configId) {
            this.addToGroup(`config:${entity.configId}`, entity.id);
        }

        this.emit('entityStored', { entity, options });
        return entity;
    }

    retrieve(entityId) {
        return this.stored.get(entityId) || this.active.get(entityId) || null;
    }

    remove(entityId) {
        const entity = this.stored.get(entityId) || this.active.get(entityId);
        if (!entity) return false;

        this.stored.delete(entityId);
        this.active.delete(entityId);
        this.history.delete(entityId);

        for (const group of this.groups.values()) {
            group.entities.delete(entityId);
        }

        this.emit('entityRemoved', { entityId, entity });
        return true;
    }

    getAllStored() { return Array.from(this.stored.values()); }

    // ========================================
    // ACTIVE ENTITIES
    // ========================================

    activate(entityOrId) {
        const entity = typeof entityOrId === 'string' ? this.stored.get(entityOrId) : entityOrId;
        if (!entity) return null;

        if (!this.stored.has(entity.id)) this.store(entity);

        this.active.set(entity.id, entity);
        entity._internal.lastTick = Date.now();

        this.emit('entityActivated', { entity });
        return entity;
    }

    deactivate(entityId) {
        const entity = this.active.get(entityId);
        if (!entity) return false;

        this.active.delete(entityId);
        this.emit('entityDeactivated', { entityId, entity });
        return true;
    }

    getActive(entityId) { return this.active.get(entityId) || null; }
    getAllActive() { return Array.from(this.active.values()); }
    isActive(entityId) { return this.active.has(entityId); }

    // ========================================
    // SPAWN CONTEXT
    // ========================================

    setSpawnContext(context) {
        this.spawnContext = { ...this.spawnContext, ...context };
        this.emit('spawnContextUpdated', { context: this.spawnContext });
        return this;
    }

    getSpawnContext() { return { ...this.spawnContext }; }
    clearSpawnContext() { this.spawnContext = {}; return this; }

    // ========================================
    // STATE HISTORY
    // ========================================

    snapshot(entityId) {
        const entity = this.retrieve(entityId);
        if (!entity) return null;

        if (!this.history.has(entityId)) this.history.set(entityId, []);

        const snapshots = this.history.get(entityId);
        const snapshot = {
            timestamp: Date.now(),
            state: JSON.parse(JSON.stringify({
                attributes: entity.attributes,
                variables: entity.variables,
                contexts: entity.contexts,
                layers: entity.layers,
                modifiers: entity.modifiers,
                compounds: entity.compounds,
                derived: entity.derived
            }))
        };

        snapshots.push(snapshot);
        if (snapshots.length > this.config.maxHistory) {
            snapshots.splice(0, snapshots.length - this.config.maxHistory);
        }

        this.emit('snapshotTaken', { entityId, snapshot });
        return snapshot;
    }

    getHistory(entityId) { return this.history.get(entityId) || []; }

    rollback(entityId, timestamp) {
        const entity = this.retrieve(entityId);
        const snapshots = this.history.get(entityId);

        if (!entity || !snapshots) return false;

        const snapshot = [...snapshots].reverse().find(s => s.timestamp <= timestamp);
        if (!snapshot) return false;

        Object.assign(entity.attributes, snapshot.state.attributes);
        Object.assign(entity.contexts, snapshot.state.contexts);
        entity.layers = JSON.parse(JSON.stringify(snapshot.state.layers));
        entity.modifiers = [...snapshot.state.modifiers];
        entity.compounds = [...snapshot.state.compounds];
        entity.derived = { ...snapshot.state.derived };

        for (const [varId, varState] of Object.entries(snapshot.state.variables)) {
            if (entity.variables[varId]) {
                entity.variables[varId].value = varState.value;
            }
        }

        this.emit('entityRolledBack', { entityId, timestamp, snapshot });
        return true;
    }

    // ========================================
    // RUNTIME - TICK
    // ========================================

    tick(entityId, deltaSeconds = null) {
        const entity = this.active.get(entityId);
        if (!entity) return null;

        const now = Date.now();
        if (deltaSeconds === null) {
            deltaSeconds = (now - entity._internal.lastTick) / 1000;
        }
        entity._internal.lastTick = now;

        for (const [varId, varState] of Object.entries(entity.variables)) {
            if (varState.changeMode === 'timed' && varState.direction !== 'none') {
                const oldValue = varState.value;
                varState.value += varState.currentRate * deltaSeconds;
                varState.value = Math.max(varState.min, Math.min(varState.max, varState.value));

                if (varState.value !== oldValue) {
                    this.checkThresholds(entity, varId);
                    this.emit('variableChanged', {
                        entityId: entity.id, varId, oldValue, newValue: varState.value
                    });
                }
            }
        }

        const expiredModifiers = [];
        for (let i = entity.modifiers.length - 1; i >= 0; i--) {
            const modId = entity.modifiers[i];
            const modState = entity._modifierStates?.[modId];

            if (modState) {
                // Skip duration countdown for static modifiers
                if (modState.isStatic) continue;

                if (modState.expiresAt && now >= modState.expiresAt) {
                    expiredModifiers.push(modId);
                } else if (modState.ticksRemaining !== undefined) {
                    modState.ticksRemaining--;
                    if (modState.ticksRemaining <= 0) expiredModifiers.push(modId);
                }
            }
        }

        for (const modId of expiredModifiers) {
            this.removeModifier(entity.id, modId);
        }

        // Check static modifier thresholds after variable updates
        this.checkModifierThresholds(entity);

        // Decrement action cooldowns
        if (entity.actions) {
            for (const [actionId, state] of Object.entries(entity.actions)) {
                if (state.cooldownRemaining > 0) {
                    state.cooldownRemaining = Math.max(0, state.cooldownRemaining - deltaSeconds);
                }
            }
        }

        if (this.spawnManager) {
            this.spawnManager.calculateDerived(entity);
        }

        this.emit('tick', { entityId: entity.id, deltaSeconds });
        return entity;
    }

    tickAll(deltaSeconds = null) {
        for (const entityId of this.active.keys()) {
            this.tick(entityId, deltaSeconds);
        }
    }

    startAutoTick(rate = null) {
        if (this.tickInterval) return;
        const tickRate = rate || this.config.tickRate;
        this.tickInterval = setInterval(() => this.tickAll(), tickRate);
        this.emit('autoTickStarted', { rate: tickRate });
    }

    stopAutoTick() {
        if (this.tickInterval) {
            clearInterval(this.tickInterval);
            this.tickInterval = null;
            this.emit('autoTickStopped');
        }
    }

    // ========================================
    // RUNTIME - VARIABLES
    // ========================================

    modifyVariable(entityId, varId, delta) {
        const entity = this.retrieve(entityId);
        if (!entity) return false;

        const varState = entity.variables[varId];
        if (!varState) return false;

        const oldValue = varState.value;
        varState.value = Math.max(varState.min, Math.min(varState.max, varState.value + delta));

        if (varState.value !== oldValue) {
            this.checkThresholds(entity, varId);
            this.checkModifierThresholds(entity);
            if (this.spawnManager) this.spawnManager.calculateDerived(entity);
            this.emit('variableChanged', { entityId, varId, oldValue, newValue: varState.value });
        }

        return true;
    }

    setVariable(entityId, varId, value) {
        const entity = this.retrieve(entityId);
        if (!entity) return false;

        const varState = entity.variables[varId];
        if (!varState) return false;

        const oldValue = varState.value;
        varState.value = Math.max(varState.min, Math.min(varState.max, value));

        if (varState.value !== oldValue) {
            this.checkThresholds(entity, varId);
            this.checkModifierThresholds(entity);
            if (this.spawnManager) this.spawnManager.calculateDerived(entity);
            this.emit('variableChanged', { entityId, varId, oldValue, newValue: varState.value });
        }

        return true;
    }

    // ========================================
    // RUNTIME - MODIFIERS
    // ========================================

    applyModifier(entityId, modifierId, config = {}) {
        const entity = this.retrieve(entityId);
        if (!entity) return false;

        if (!entity._modifierStates) entity._modifierStates = {};

        const existing = entity.modifiers.includes(modifierId);
        const isStatic = config.isStatic || config.trigger?.static || false;

        if (existing && entity._modifierStates[modifierId]) {
            const modState = entity._modifierStates[modifierId];
            if (config.stacking === 'refresh') {
                modState.appliedAt = Date.now();
                if (!isStatic && config.duration && config.durationType === 'timed') {
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
                isStatic: isStatic,
                // Static modifiers don't have duration - they expire based on removal conditions
                expiresAt: !isStatic && config.durationType === 'timed' && config.duration
                    ? Date.now() + (config.duration * 1000) : null,
                ticksRemaining: !isStatic && config.durationType === 'ticks' ? config.duration : undefined
            };
        }

        this._runCascade(entity);

        this.emit('modifierApplied', { entityId, modifierId });
        return true;
    }

    removeModifier(entityId, modifierId) {
        const entity = this.retrieve(entityId);
        if (!entity) return false;

        const index = entity.modifiers.indexOf(modifierId);
        if (index === -1) return false;

        entity.modifiers.splice(index, 1);
        if (entity._modifierStates) delete entity._modifierStates[modifierId];

        this._runCascade(entity);

        this.emit('modifierRemoved', { entityId, modifierId });
        return true;
    }

    // ========================================
    // RUNTIME - TRAITS
    // ========================================

    activateTrait(entityId, traitId) {
        const entity = this.retrieve(entityId);
        if (!entity || !this.spawnManager) return false;

        const result = this.spawnManager.activateTrait(entity, traitId);
        if (result) {
            this._runCascade(entity);
            this.emit('traitActivated', { entityId, traitId });
        }
        return result;
    }

    deactivateTrait(entityId, traitId) {
        const entity = this.retrieve(entityId);
        if (!entity || !this.spawnManager) return false;

        const result = this.spawnManager.deactivateTrait(entity, traitId);
        if (result) {
            this._runCascade(entity);
            this.emit('traitDeactivated', { entityId, traitId });
        }
        return result;
    }

    /**
     * Run the cascade recalculation triple (rates, compounds, derived).
     * If batching is active, marks dirty and defers execution.
     * @param {Object} entity - The entity to recalculate
     */
    _runCascade(entity) {
        if (this._batchingCascade) {
            this._cascadeDirty = true;
            this._cascadeEntity = entity;
            return;
        }
        if (!this.spawnManager) return;
        this.spawnManager.recalculateRates(entity);
        this.spawnManager.checkCompounds(entity);
        this.spawnManager.calculateDerived(entity);
    }

    // ========================================
    // THRESHOLDS
    // ========================================

    checkThresholds(entity, varId) {
        if (!this.spawnManager) return;

        const varState = entity.variables[varId];

        const traits = this.spawnManager._thresholdTraitsByVar.get(varId) || [];

        for (const trait of traits) {
            const trigger = trait.config.selection.trigger;
            const autoRemove = trait.config.selection.autoRemove;
            const layerId = trait.config.layerId;
            const isActive = entity.layers[layerId]?.active?.includes(trait.id);

            if (!isActive && this.evaluateThreshold(varState.value, trigger)) {
                this.activateTrait(entity.id, trait.id);
            }

            if (isActive && autoRemove && this.evaluateThreshold(varState.value, autoRemove)) {
                this.deactivateTrait(entity.id, trait.id);
            }
        }
    }

    evaluateThreshold(value, condition) {
        if (!condition) return false;
        const threshold = condition.value;
        switch (condition.operator || condition.op) {
            case '<': return value < threshold;
            case '<=': return value <= threshold;
            case '>': return value > threshold;
            case '>=': return value >= threshold;
            case '=':
            case '==': return value === threshold;
            case '!=': return value !== threshold;
            default: return false;
        }
    }

    /**
     * Get the current numeric value of a node (delegates to SpawnManager).
     * Needed by evaluateSingleCondition for threshold comparisons.
     */
    getNodeValue(entity, nodeId) {
        if (this.spawnManager) {
            return this.spawnManager.getNodeValue(entity, nodeId);
        }
        // Fallback: check entity directly
        if (entity.attributes && entity.attributes[nodeId] !== undefined) return entity.attributes[nodeId];
        if (entity.variables && entity.variables[nodeId]) return entity.variables[nodeId].value;
        if (entity.derived && entity.derived[nodeId] !== undefined) return entity.derived[nodeId];
        return null;
    }

    /**
     * Evaluate multi-condition trigger with per-expression connectors
     * Supports both new format (connector per condition) and legacy format (global logic)
     * @param {Object} entity - The entity to evaluate against
     * @param {Object} trigger - The trigger config with conditions array
     * @returns {boolean} - Whether the trigger conditions are met
     */
    evaluateModifierTrigger(entity, trigger) {
        if (!trigger) return false;

        // Multi-condition format
        if (trigger.conditions && trigger.conditions.length > 0) {
            return this.evaluateConditionsWithConnectors(entity, trigger.conditions, trigger.logic);
        }

        // Single condition (backwards compatibility)
        if (trigger.target) {
            const value = this.getNodeValue(entity, trigger.target);
            if (value === null || value === undefined) return false;
            return this.evaluateThreshold(value, trigger);
        }

        return false;
    }

    /**
     * Evaluate a list of conditions with per-expression connectors
     * @param {Object} entity - The entity to evaluate against
     * @param {Array} conditions - Array of conditions with optional connector property
     * @param {string} fallbackLogic - Fallback logic if no connectors (legacy format)
     * @returns {boolean} - Whether the conditions are met
     */
    evaluateConditionsWithConnectors(entity, conditions, fallbackLogic = 'all') {
        if (!conditions || conditions.length === 0) return false;

        // Evaluate first condition
        let result = this.evaluateConditionOrGroup(entity, conditions[0]);

        // Combine with subsequent conditions using their connectors
        for (let i = 1; i < conditions.length; i++) {
            const cond = conditions[i];
            const condResult = this.evaluateConditionOrGroup(entity, cond);

            // Use condition's connector, or fallback to global logic (for backwards compat)
            const connector = cond.connector || (fallbackLogic === 'any' ? 'OR' : 'AND');

            if (connector === 'OR') {
                result = result || condResult;
            } else {
                // AND
                result = result && condResult;
            }
        }

        return result;
    }

    /**
     * Evaluate removal conditions for static modifiers
     * For static modifiers without explicit removeConditions, removal happens when apply conditions are no longer met
     * @param {Object} entity - The entity to evaluate against
     * @param {Object} trigger - The trigger config
     * @returns {boolean} - Whether the removal conditions are met
     */
    evaluateRemoveConditions(entity, trigger) {
        if (!trigger) return false;

        // If explicit removeConditions exist, evaluate them
        if (trigger.removeConditions && trigger.removeConditions.length > 0) {
            return this.evaluateConditionsWithConnectors(entity, trigger.removeConditions, trigger.removeLogic);
        }

        // For static modifiers without explicit remove conditions,
        // removal happens when apply conditions are NO LONGER met (inverse)
        if (trigger.static && trigger.conditions && trigger.conditions.length > 0) {
            return !this.evaluateConditionsWithConnectors(entity, trigger.conditions, trigger.logic);
        }

        return false;
    }

    /**
     * Evaluate a single condition or a condition group
     * Groups use per-expression connectors (AND/OR between each condition)
     * @param {Object} entity - The entity to evaluate against
     * @param {Object} cond - A condition or condition group
     * @returns {boolean} - Whether the condition is met
     */
    evaluateConditionOrGroup(entity, cond) {
        // Check if this is a group
        if (cond.type === 'group' && cond.conditions && cond.conditions.length > 0) {
            // Use per-expression connectors within the group
            let result = this.evaluateSingleCondition(entity, cond.conditions[0]);

            for (let i = 1; i < cond.conditions.length; i++) {
                const innerCond = cond.conditions[i];
                const innerResult = this.evaluateSingleCondition(entity, innerCond);

                // Use connector from condition, default to OR inside groups (common pattern)
                const connector = innerCond.connector || 'OR';

                if (connector === 'OR') {
                    result = result || innerResult;
                } else {
                    result = result && innerResult;
                }
            }

            return result;
        }

        // Single condition
        return this.evaluateSingleCondition(entity, cond);
    }

    /**
     * Evaluate a single condition (not a group)
     * Supports 'active'/'inactive' operators for checking node state
     * @param {Object} entity - The entity to evaluate against
     * @param {Object} cond - The condition with target, operator, value
     * @returns {boolean} - Whether the condition is met
     */
    evaluateSingleCondition(entity, cond) {
        if (!cond || !cond.target) return false;

        // Check for 'active'/'inactive' operators (for traits, modifiers, compounds)
        if (cond.operator === 'active') {
            return this.isNodeActive(entity, cond.target);
        }
        if (cond.operator === 'inactive') {
            return !this.isNodeActive(entity, cond.target);
        }

        // Numeric comparison
        const value = this.getNodeValue(entity, cond.target);
        if (value === null || value === undefined) return false;
        return this.evaluateThreshold(value, cond);
    }

    /**
     * Check if a node (trait, modifier, compound) is active on an entity
     * @param {Object} entity - The entity to check
     * @param {string} nodeId - The node ID to check
     * @returns {boolean} - Whether the node is active
     */
    isNodeActive(entity, nodeId) {
        if (!this.spawnManager) return false;
        return this.spawnManager.isNodeActive(entity, nodeId);
    }

    /**
     * Check all static modifier thresholds and auto-apply/remove as needed
     * Called after variable updates in tick()
     * @param {Object} entity - The entity to check
     */
    checkModifierThresholds(entity) {
        if (!this.spawnManager) return;

        const modifiers = this.spawnManager._thresholdModifiers;

        // Use pre-computed exclusive groups
        const exclusiveGroups = this.spawnManager._exclusiveGroups;

        // Resolve exclusive groups first (pick winner per group)
        const groupWinners = this.resolveExclusiveGroups(entity, exclusiveGroups, modifiers);

        // Batch cascade: defer recalculations until all modifier changes are resolved
        this._batchingCascade = true;
        this._cascadeDirty = false;

        for (const modifier of modifiers) {
            const trigger = modifier.config.trigger;
            const isActive = entity.modifiers.includes(modifier.id);
            const isStatic = trigger.static || false;
            const shouldApply = this.evaluateModifierTrigger(entity, trigger);

            // Check if this modifier is in an exclusive group
            const groupResult = groupWinners.get(modifier.id);

            if (groupResult !== undefined) {
                // Exclusive group member — only the winner applies
                if (groupResult === true && !isActive) {
                    this.applyModifier(entity.id, modifier.id, {
                        ...modifier.config,
                        isStatic: isStatic
                    });
                } else if (groupResult === false && isActive) {
                    this.removeModifier(entity.id, modifier.id);
                }
            } else {
                // Not in an exclusive group — original behavior
                if (!isActive && shouldApply) {
                    this.applyModifier(entity.id, modifier.id, {
                        ...modifier.config,
                        isStatic: isStatic
                    });
                } else if (isActive && isStatic) {
                    const shouldRemove = this.evaluateRemoveConditions(entity, trigger);
                    if (shouldRemove) {
                        this.removeModifier(entity.id, modifier.id);
                    }
                }
            }
        }

        // Flush: run cascade once if any modifiers changed
        this._batchingCascade = false;
        if (this._cascadeDirty) {
            this._cascadeDirty = false;
            this._cascadeEntity = null;
            if (this.spawnManager) {
                this.spawnManager.recalculateRates(entity);
                this.spawnManager.checkCompounds(entity);
                this.spawnManager.calculateDerived(entity);
            }
        }
    }

    /**
     * Build exclusive groups from modifier exclusiveWith config
     * Returns a Map of modId -> Set of exclusive partner mod IDs
     */
    buildExclusiveGroups(modifiers) {
        const groups = new Map();
        for (const mod of modifiers) {
            const exclusive = mod.config.exclusiveWith;
            if (exclusive && exclusive.length > 0) {
                if (!groups.has(mod.id)) groups.set(mod.id, new Set());
                for (const partnerId of exclusive) {
                    groups.get(mod.id).add(partnerId);
                    // Ensure bidirectional: partner also knows about this modifier
                    if (!groups.has(partnerId)) groups.set(partnerId, new Set());
                    groups.get(partnerId).add(mod.id);
                }
            }
        }
        return groups;
    }

    /**
     * Resolve exclusive groups: for each group, evaluate all members and pick the winner.
     * Returns a Map of modId -> true (winner) | false (loser) for all group members.
     * Modifiers not in any group are not included in the map.
     */
    resolveExclusiveGroups(entity, exclusiveMap, modifiers) {
        const results = new Map();
        const visited = new Set();

        for (const [modId, partners] of exclusiveMap) {
            if (visited.has(modId)) continue;

            // Collect the full group (transitive closure)
            const group = new Set([modId]);
            const queue = [modId];
            while (queue.length > 0) {
                const current = queue.pop();
                const currentPartners = exclusiveMap.get(current);
                if (currentPartners) {
                    for (const p of currentPartners) {
                        if (!group.has(p)) {
                            group.add(p);
                            queue.push(p);
                        }
                    }
                }
            }

            // Mark all as visited
            for (const id of group) visited.add(id);

            // Evaluate which members' conditions are currently met
            const candidates = [];
            for (const id of group) {
                const mod = modifiers.find(m => m.id === id);
                if (mod && this.evaluateModifierTrigger(entity, mod.config.trigger)) {
                    candidates.push(mod);
                }
            }

            if (candidates.length === 0) {
                // No conditions met — all losers (remove any active)
                for (const id of group) results.set(id, false);
            } else if (candidates.length === 1) {
                // Only one qualifies — it wins
                for (const id of group) results.set(id, id === candidates[0].id);
            } else {
                // Multiple qualify — pick most specific
                const winner = this.getMostSpecificModifier(candidates);
                for (const id of group) results.set(id, id === winner.id);
            }
        }

        return results;
    }

    /**
     * Among multiple modifiers whose conditions are all met,
     * pick the most specific (narrowest threshold).
     * For same-variable same-operator: <= uses lowest value, >= uses highest value.
     * Falls back to config node order.
     */
    getMostSpecificModifier(candidates) {
        // Try to auto-detect specificity from single-condition triggers on same variable
        const singleCondCandidates = candidates.filter(m =>
            m.config.trigger?.conditions?.length === 1
        );

        if (singleCondCandidates.length === candidates.length) {
            const conds = singleCondCandidates.map(m => ({
                mod: m,
                cond: m.config.trigger.conditions[0]
            }));

            // Check if all target the same variable
            const targets = new Set(conds.map(c => c.cond.target));
            if (targets.size === 1) {
                // Group by operator direction
                const leOps = conds.filter(c => c.cond.operator === '<=' || c.cond.operator === '<');
                const geOps = conds.filter(c => c.cond.operator === '>=' || c.cond.operator === '>');

                if (leOps.length === conds.length) {
                    // All <= or <: lowest threshold value is most specific
                    leOps.sort((a, b) => a.cond.value - b.cond.value);
                    return leOps[0].mod;
                }
                if (geOps.length === conds.length) {
                    // All >= or >: highest threshold value is most specific
                    geOps.sort((a, b) => b.cond.value - a.cond.value);
                    return geOps[0].mod;
                }
            }
        }

        // Fallback: first candidate in config node order (already filtered from modifiers array)
        return candidates[0];
    }

    // ========================================
    // QUERYING
    // ========================================

    query(filter = {}) {
        let results = [];

        if (filter.fromGroup) {
            results = this.getGroup(filter.fromGroup);
        } else if (filter.fromActive) {
            results = this.getAllActive();
        } else {
            results = this.getAllStored();
        }

        if (filter.where) {
            results = results.filter(entity => this.matchesWhere(entity, filter.where));
        }

        if (filter.sortBy) {
            const desc = filter.sortDesc || false;
            results.sort((a, b) => {
                const aVal = this.getNestedValue(a, filter.sortBy) || 0;
                const bVal = this.getNestedValue(b, filter.sortBy) || 0;
                return desc ? bVal - aVal : aVal - bVal;
            });
        }

        if (filter.limit) {
            results = results.slice(0, filter.limit);
        }

        return results;
    }

    matchesWhere(entity, where) {
        for (const [path, condition] of Object.entries(where)) {
            const actual = this.getNestedValue(entity, path);
            if (typeof condition === 'object' && condition !== null) {
                for (const [op, value] of Object.entries(condition)) {
                    if (!this.compareValues(actual, op, value)) return false;
                }
            } else {
                if (actual !== condition) return false;
            }
        }
        return true;
    }

    getNestedValue(obj, path) {
        return path.split('.').reduce((curr, key) => curr?.[key], obj);
    }

    compareValues(actual, op, expected) {
        switch (op) {
            case 'eq': return actual === expected;
            case 'ne': return actual !== expected;
            case 'gt': return actual > expected;
            case 'gte': return actual >= expected;
            case 'lt': return actual < expected;
            case 'lte': return actual <= expected;
            case 'in': return Array.isArray(expected) && expected.includes(actual);
            case 'includes': return Array.isArray(actual) && actual.includes(expected);
            default: return false;
        }
    }

    // ========================================
    // STATE SUMMARY
    // ========================================

    getState(entityId) {
        const entity = this.retrieve(entityId);
        if (!entity) return null;

        const activeTraits = [];
        for (const [layerId, layerState] of Object.entries(entity.layers)) {
            for (const traitId of layerState.active) {
                const trait = this.spawnManager?.getNode(traitId);
                activeTraits.push({ id: traitId, name: trait?.name || traitId, layerId });
            }
        }

        const activeModifiers = entity.modifiers.map(modId => {
            const mod = this.spawnManager?.getNode(modId);
            const state = entity._modifierStates?.[modId] || {};
            return { id: modId, name: mod?.name || modId, stacks: state.stacks, expiresAt: state.expiresAt };
        });

        const activeCompounds = entity.compounds.map(compId => {
            const comp = this.spawnManager?.getNode(compId);
            return { id: compId, name: comp?.name || compId };
        });

        return {
            id: entity.id,
            name: entity.name,
            presetId: entity.presetId,
            createdAt: entity.createdAt,
            isActive: this.active.has(entity.id),
            attributes: { ...entity.attributes },
            variables: Object.fromEntries(
                Object.entries(entity.variables).map(([k, v]) => [k, {
                    value: v.value, rate: v.currentRate, min: v.min, max: v.max
                }])
            ),
            contexts: { ...entity.contexts },
            activeTraits,
            activeModifiers,
            activeCompounds,
            derived: { ...entity.derived }
        };
    }

    // ========================================
    // ENTITY POOLING
    // ========================================

    /**
     * Configure the entity pool for reuse/recycling.
     * Useful for scenarios with frequent spawn/despawn (JRPG combat, bullet hell, etc.)
     *
     * @param {Object} config - Pool configuration
     * @param {number} [config.maxSize=100] - Maximum entities to keep in pool
     * @param {number} [config.preWarm=0] - Number of entities to pre-create
     * @param {string} [config.preWarmPreset=null] - Preset to use for pre-warming
     * @param {number} [config.shrinkThreshold=0.5] - Shrink pool when usage below this ratio
     * @param {number} [config.shrinkDelay=30000] - Delay before shrinking (ms)
     * @returns {EntityManager} This instance for chaining
     * @example
     * // JRPG combat setup
     * entityManager.configurePool({
     *   maxSize: 50,
     *   preWarm: 10,
     *   preWarmPreset: 'enemy_goblin'
     * });
     */
    configurePool(config) {
        this.poolConfig = { ...this.poolConfig, ...config };

        // Pre-warm if requested
        if (config.preWarm && config.preWarm > 0) {
            this.preWarmPool(config.preWarm, config.preWarmPreset);
        }

        return this;
    }

    /**
     * Acquire an entity from the pool or create a new one.
     * Faster than spawn() for high-frequency scenarios.
     *
     * @param {string|Object} [presetIdOrOverrides] - Preset ID or override object
     * @param {Object} [overrides={}] - Additional overrides when using preset
     * @returns {Object} The acquired entity
     * @example
     * // Acquire enemy for combat
     * const enemy = entityManager.acquire('enemy_goblin');
     *
     * // Acquire with overrides
     * const boss = entityManager.acquire('enemy_goblin', {
     *   attributes: { strength: 20 }
     * });
     *
     * // When combat ends, release back to pool
     * entityManager.release(enemy);
     */
    acquire(presetIdOrOverrides, overrides = {}) {
        let entity;
        let fromPool = false;

        // Try to get from pool first
        if (this.pool.length > 0) {
            entity = this.pool.pop();
            fromPool = true;

            // Reset entity state for reuse
            this._resetEntityForReuse(entity, presetIdOrOverrides, overrides);

            this.poolStats.available--;
        } else {
            // Create new entity
            if (!this.spawnManager) {
                throw new Error('EntityManager requires a linked SpawnManager for acquire()');
            }

            if (typeof presetIdOrOverrides === 'string') {
                entity = this.spawnManager.spawn(presetIdOrOverrides, overrides);
            } else {
                entity = this.spawnManager.generate(presetIdOrOverrides || overrides);
            }

            this.poolStats.totalCreated++;
        }

        if (entity) {
            // Store and activate
            this.store(entity);
            this.activate(entity);

            this.poolStats.inUse++;
            this.poolStats.totalAcquired++;

            this.emit('entityAcquired', { entityId: entity.id, fromPool });
        }

        return entity;
    }

    /**
     * Release an entity back to the pool for reuse.
     * Entity is deactivated and removed from active tracking.
     *
     * @param {Object|string} entityOrId - Entity or entity ID to release
     * @returns {boolean} True if released to pool, false if pool full or entity not found
     * @example
     * // Release enemy after combat
     * entityManager.release(enemy);
     * entityManager.release('entity_123');
     */
    release(entityOrId) {
        const entityId = typeof entityOrId === 'string' ? entityOrId : entityOrId?.id;
        const entity = this.stored.get(entityId);

        if (!entity) return false;

        // Deactivate and remove from tracking
        this.deactivate(entityId);
        this.stored.delete(entityId);
        this.active.delete(entityId);

        // Clear history for this entity
        this.history.delete(entityId);

        // Remove from all groups
        for (const group of this.groups.values()) {
            group.entities.delete(entityId);
        }

        this.poolStats.inUse = Math.max(0, this.poolStats.inUse - 1);
        this.poolStats.totalReleased++;

        // Add to pool if not full
        if (this.pool.length < this.poolConfig.maxSize) {
            // Clean up entity for pooling
            this._prepareEntityForPool(entity);
            this.pool.push(entity);
            this.poolStats.available++;
            this.poolStats.size = this.pool.length;

            this.emit('entityReleased', { entityId, toPool: true });

            // Schedule shrink check
            this._scheduleShrinkCheck();

            return true;
        }

        this.emit('entityReleased', { entityId, toPool: false });
        return false;
    }

    /**
     * Pre-warm the pool by creating entities ahead of time.
     * Useful to avoid spawn hitches during gameplay.
     *
     * @param {number} count - Number of entities to pre-create
     * @param {string} [presetId] - Preset to use (random if not specified)
     * @returns {EntityManager} This instance for chaining
     * @example
     * // Pre-warm for wave-based combat
     * entityManager.preWarmPool(20, 'enemy_basic');
     */
    preWarmPool(count, presetId = null) {
        if (!this.spawnManager) {
            console.warn('EntityManager requires a linked SpawnManager for preWarmPool()');
            return this;
        }

        const toCreate = Math.min(count, this.poolConfig.maxSize - this.pool.length);

        for (let i = 0; i < toCreate; i++) {
            let entity;
            if (presetId) {
                entity = this.spawnManager.spawn(presetId);
            } else {
                entity = this.spawnManager.generate();
            }

            if (entity) {
                this._prepareEntityForPool(entity);
                this.pool.push(entity);
                this.poolStats.totalCreated++;
            }
        }

        this.poolStats.size = this.pool.length;
        this.poolStats.available = this.pool.length;

        return this;
    }

    /**
     * Clear all entities from the pool.
     *
     * @returns {EntityManager} This instance for chaining
     */
    clearPool() {
        this.pool = [];
        this.poolStats.size = 0;
        this.poolStats.available = 0;

        if (this._shrinkTimeout) {
            clearTimeout(this._shrinkTimeout);
            this._shrinkTimeout = null;
        }

        return this;
    }

    /**
     * Get current pool statistics.
     *
     * @returns {Object} Pool stats
     * @example
     * const stats = entityManager.getPoolStats();
     * console.log(`Pool: ${stats.available}/${stats.size} available, ${stats.inUse} in use`);
     */
    getPoolStats() {
        return {
            ...this.poolStats,
            size: this.pool.length,
            available: this.pool.length
        };
    }

    /**
     * Reset an entity's state for reuse from pool.
     * @private
     */
    _resetEntityForReuse(entity, presetIdOrOverrides, overrides = {}) {
        if (!this.spawnManager) return;

        // Get preset or overrides
        let preset = null;
        let finalOverrides = overrides;

        if (typeof presetIdOrOverrides === 'string') {
            preset = this.getPreset(presetIdOrOverrides);
        } else if (presetIdOrOverrides) {
            finalOverrides = { ...presetIdOrOverrides, ...overrides };
        }

        // Generate fresh ID
        entity.id = `entity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        entity.createdAt = Date.now();
        entity.presetId = preset?.id || null;

        // Re-roll attributes
        const attributes = this.spawnManager.getAttributes();
        for (const attr of attributes) {
            const cfg = attr.config;
            const range = cfg.defaultRange || [cfg.min, cfg.max];

            // Check for override (supports fixed values, ranges, and variance)
            if (preset?.attributes?.[attr.id] !== undefined) {
                entity.attributes[attr.id] = this.spawnManager.resolvePresetAttributeValue(
                    preset.attributes[attr.id],
                    cfg.precision ?? 0
                );
            } else if (finalOverrides.attributes?.[attr.id] !== undefined) {
                entity.attributes[attr.id] = this.spawnManager.resolvePresetAttributeValue(
                    finalOverrides.attributes[attr.id],
                    cfg.precision ?? 0
                );
            } else {
                entity.attributes[attr.id] = this.spawnManager.rollRange(range[0], range[1], cfg.precision ?? 0);
            }
        }

        // Reset variables to initial
        const variables = this.spawnManager.getVariables();
        for (const varNode of variables) {
            const cfg = varNode.config;
            entity.variables[varNode.id] = {
                value: cfg.initial ?? cfg.min ?? 0,
                baseRate: cfg.baseRate ?? 0,
                currentRate: cfg.baseRate ?? 0,
                min: cfg.min ?? 0,
                max: cfg.max ?? 100,
                changeMode: cfg.changeMode || 'manual',
                direction: cfg.direction || 'none'
            };
        }

        // Clear layers
        for (const layerId of Object.keys(entity.layers)) {
            entity.layers[layerId] = { active: [], lastRoll: null };
        }

        // Clear modifiers and compounds
        entity.modifiers = [];
        entity.compounds = [];
        entity._modifierStates = {};

        // Clear derived
        entity.derived = {};

        // Clear internal log
        entity._internal = {
            log: [],
            lastTick: Date.now()
        };

        // Re-roll initial layers
        const layers = this.spawnManager.getLayers();
        for (const layer of layers) {
            const timing = layer.config?.timing?.rollAt || 'spawn';
            if (timing === 'spawn' || timing === 'create') {
                this.spawnManager.rollLayer(entity, layer.id);
            }
        }

        // Force traits if specified (supports both legacy forceTraits and new traits object)
        const forceTraits = [
            ...(preset?.forceTraits || []),
            ...this.spawnManager.resolvePresetTraits(preset?.traits),
            ...(finalOverrides.forceTraits || []),
            ...this.spawnManager.resolvePresetTraits(finalOverrides.traits)
        ];
        for (const traitId of forceTraits) {
            this.spawnManager.forceActivateTrait(entity, traitId);
        }

        // Recalculate
        this._runCascade(entity);
    }

    /**
     * Prepare an entity for storage in the pool.
     * @private
     */
    _prepareEntityForPool(entity) {
        // Clear most state but keep structure
        entity._internal = { log: [], lastTick: 0 };
        entity.modifiers = [];
        entity.compounds = [];
        entity._modifierStates = {};

        // Clear layer actives but keep structure
        for (const layerId of Object.keys(entity.layers)) {
            entity.layers[layerId] = { active: [], lastRoll: null };
        }
    }

    /**
     * Schedule a pool shrink check (legacy - delegates to default pool).
     * @private
     * @deprecated Use _scheduleShrinkCheckForPool() instead
     */
    _scheduleShrinkCheck() {
        this._scheduleShrinkCheckForPool(this.defaultPoolId);
    }

    /**
     * Check if pool should shrink.
     * @private
     * @param {string} [poolId] - Pool to check (defaults to default pool)
     */
    _checkPoolShrink(poolId = this.defaultPoolId) {
        const pool = this.pools.get(poolId);
        if (!pool) return;

        const usage = pool.stats.inUse / (pool.stats.inUse + pool.entities.length);

        if (usage < pool.config.shrinkThreshold && pool.entities.length > 10) {
            // Shrink to half size
            const targetSize = Math.max(10, Math.floor(pool.entities.length / 2));
            while (pool.entities.length > targetSize) {
                pool.entities.pop();
            }
            pool.stats.size = pool.entities.length;
            pool.stats.available = pool.entities.length;

            // Sync legacy references for default pool
            if (poolId === this.defaultPoolId) {
                this.poolStats.size = pool.stats.size;
                this.poolStats.available = pool.stats.available;
            }
        }
    }

    /**
     * Schedule a pool shrink check for a specific pool.
     * @private
     * @param {string} [poolId] - Pool to schedule check for
     */
    _scheduleShrinkCheckForPool(poolId = this.defaultPoolId) {
        const pool = this.pools.get(poolId);
        if (!pool || pool._shrinkTimeout) return;
        if (!pool.config.shrinkDelay) return;

        pool._shrinkTimeout = setTimeout(() => {
            pool._shrinkTimeout = null;
            this._checkPoolShrink(poolId);
        }, pool.config.shrinkDelay);
    }

    // ========================================
    // MULTI-POOL MANAGEMENT
    // ========================================

    /**
     * Create a new named entity pool.
     *
     * @param {string} poolId - Unique pool identifier
     * @param {Object} [options={}] - Pool configuration
     * @param {string} [options.name] - Display name for the pool
     * @param {string} [options.description] - Pool description
     * @param {number} [options.maxSize=100] - Maximum entities in pool
     * @param {number} [options.preWarm=0] - Entities to pre-create
     * @param {string} [options.preWarmPreset] - Preset for pre-warming
     * @param {number} [options.shrinkThreshold=0.5] - Shrink when usage below ratio
     * @param {number} [options.shrinkDelay=30000] - Delay before shrinking (ms)
     * @param {Object} [options.rules] - Assignment rules for this pool
     * @returns {Object} The created pool instance
     * @fires EntityManager#poolCreated
     * @example
     * manager.createPool('enemies', {
     *   name: 'Enemy Pool',
     *   maxSize: 50,
     *   preWarm: 10,
     *   preWarmPreset: 'goblin',
     *   rules: { conditions: [{ source: 'preset', match: 'enemy_*' }] }
     * });
     */
    createPool(poolId, options = {}) {
        if (this.pools.has(poolId)) {
            console.warn(`Pool '${poolId}' already exists. Use configurePool() to modify.`);
            return this.pools.get(poolId);
        }

        const pool = {
            id: poolId,
            name: options.name || poolId,
            description: options.description || '',
            config: {
                maxSize: options.maxSize ?? 100,
                preWarm: options.preWarm ?? 0,
                preWarmPreset: options.preWarmPreset ?? null,
                shrinkThreshold: options.shrinkThreshold ?? 0.5,
                shrinkDelay: options.shrinkDelay ?? 30000
            },
            stats: {
                size: 0,
                available: 0,
                inUse: 0,
                totalAcquired: 0,
                totalReleased: 0,
                totalCreated: 0
            },
            entities: [],
            rules: options.rules || null,
            _shrinkTimeout: null
        };

        this.pools.set(poolId, pool);
        this.emit('poolCreated', { poolId, pool });

        // Pre-warm if requested
        if (pool.config.preWarm > 0) {
            this.preWarmPool(pool.config.preWarm, pool.config.preWarmPreset, poolId);
        }

        return pool;
    }

    /**
     * Get a pool by ID.
     *
     * @param {string} poolId - Pool identifier
     * @returns {Object|null} The pool instance or null if not found
     */
    getPool(poolId) {
        return this.pools.get(poolId) || null;
    }

    /**
     * List all pools.
     *
     * @returns {Array<Object>} Array of pool summaries
     * @example
     * const pools = manager.listPools();
     * // [{ id: 'default', name: 'Default Pool', stats: {...} }, ...]
     */
    listPools() {
        return Array.from(this.pools.values()).map(pool => ({
            id: pool.id,
            name: pool.name,
            description: pool.description,
            stats: { ...pool.stats },
            hasRules: !!pool.rules
        }));
    }

    /**
     * Remove a pool. Entities in the pool are moved to default pool.
     *
     * @param {string} poolId - Pool to remove
     * @returns {boolean} True if removed, false if not found or is default
     * @fires EntityManager#poolRemoved
     */
    removePool(poolId) {
        if (poolId === this.defaultPoolId) {
            console.warn('Cannot remove the default pool.');
            return false;
        }

        const pool = this.pools.get(poolId);
        if (!pool) return false;

        // Move pooled entities to default pool
        const defaultPool = this.pools.get(this.defaultPoolId);
        for (const entity of pool.entities) {
            if (defaultPool.entities.length < defaultPool.config.maxSize) {
                entity.poolId = this.defaultPoolId;
                defaultPool.entities.push(entity);
                defaultPool.stats.available++;
                defaultPool.stats.size++;
            }
        }

        // Clear timeout
        if (pool._shrinkTimeout) {
            clearTimeout(pool._shrinkTimeout);
        }

        this.pools.delete(poolId);
        this.emit('poolRemoved', { poolId });

        // Sync legacy references
        this.poolStats.size = defaultPool.stats.size;
        this.poolStats.available = defaultPool.stats.available;

        return true;
    }

    /**
     * Configure a specific pool (or default pool for backward compatibility).
     *
     * @param {string|Object} poolIdOrConfig - Pool ID or config object (for backward compat)
     * @param {Object} [config] - Configuration when poolId is provided
     * @returns {EntityManager} This instance for chaining
     * @example
     * // New API - configure named pool
     * manager.configurePool('enemies', { maxSize: 50 });
     *
     * // Legacy API - configure default pool
     * manager.configurePool({ maxSize: 100 });
     */
    configurePool(poolIdOrConfig, config = null) {
        let poolId, poolConfig;

        // Backward compatibility: single object = default pool config
        if (typeof poolIdOrConfig === 'object') {
            poolId = this.defaultPoolId;
            poolConfig = poolIdOrConfig;
        } else {
            poolId = poolIdOrConfig;
            poolConfig = config || {};
        }

        const pool = this.pools.get(poolId);
        if (!pool) {
            console.warn(`Pool '${poolId}' not found. Use createPool() first.`);
            return this;
        }

        // Update config
        pool.config = { ...pool.config, ...poolConfig };

        // Sync legacy references for default pool
        if (poolId === this.defaultPoolId) {
            this.poolConfig = { ...pool.config };
        }

        // Pre-warm if requested
        if (poolConfig.preWarm && poolConfig.preWarm > 0) {
            this.preWarmPool(poolConfig.preWarm, poolConfig.preWarmPreset, poolId);
        }

        this.emit('poolConfigured', { poolId, config: pool.config });
        return this;
    }

    /**
     * Acquire an entity from a specific pool or determine pool via rules.
     *
     * @param {string|Object} [presetIdOrOverrides] - Preset ID or override object
     * @param {Object} [overrides={}] - Additional overrides
     * @param {string} [targetPoolId] - Specific pool to acquire from (auto-determined if omitted)
     * @returns {Object} The acquired entity
     * @fires EntityManager#entityAcquired
     * @example
     * // Acquire from auto-determined pool
     * const entity = manager.acquire('enemy_goblin');
     *
     * // Acquire from specific pool
     * const entity = manager.acquire('enemy_goblin', {}, 'enemies');
     */
    acquire(presetIdOrOverrides, overrides = {}, targetPoolId = null) {
        let entity;
        let fromPool = false;
        let poolId;

        // Determine target pool
        if (targetPoolId) {
            poolId = targetPoolId;
        } else {
            // Will be determined after entity generation if rules exist
            poolId = this.defaultPoolId;
        }

        const pool = this.pools.get(poolId);
        if (!pool) {
            console.warn(`Pool '${poolId}' not found, using default.`);
            poolId = this.defaultPoolId;
        }

        const actualPool = this.pools.get(poolId);

        // Try to get from pool first
        if (actualPool.entities.length > 0) {
            entity = actualPool.entities.pop();
            fromPool = true;

            // Reset entity state for reuse
            this._resetEntityForReuse(entity, presetIdOrOverrides, overrides);

            actualPool.stats.available--;
        } else {
            // Create new entity
            if (!this.spawnManager) {
                throw new Error('EntityManager requires a linked SpawnManager for acquire()');
            }

            if (typeof presetIdOrOverrides === 'string') {
                entity = this.spawnManager.spawn(presetIdOrOverrides, overrides);
            } else {
                entity = this.spawnManager.generate(presetIdOrOverrides || overrides);
            }

            actualPool.stats.totalCreated++;
        }

        if (entity) {
            // Determine final pool if rules exist and no explicit target
            if (!targetPoolId) {
                const determinedPoolId = this.getPoolForEntity(entity);
                if (determinedPoolId !== poolId) {
                    // Entity belongs to a different pool based on rules
                    poolId = determinedPoolId;
                }
            }

            // Set pool association on entity
            entity.poolId = poolId;

            // Store and activate
            this.store(entity);
            this.activate(entity);

            actualPool.stats.inUse++;
            actualPool.stats.totalAcquired++;

            // Sync legacy stats for default pool
            if (poolId === this.defaultPoolId) {
                this.poolStats.inUse = actualPool.stats.inUse;
                this.poolStats.totalAcquired = actualPool.stats.totalAcquired;
                this.poolStats.totalCreated = actualPool.stats.totalCreated;
            }

            this.emit('entityAcquired', { entityId: entity.id, fromPool, poolId });
        }

        return entity;
    }

    /**
     * Release an entity back to its pool (or specified pool).
     *
     * @param {Object|string} entityOrId - Entity or entity ID
     * @param {string} [targetPoolId] - Pool to release to (uses entity's poolId if omitted)
     * @returns {boolean} True if released to pool
     * @fires EntityManager#entityReleased
     */
    release(entityOrId, targetPoolId = null) {
        const entityId = typeof entityOrId === 'string' ? entityOrId : entityOrId?.id;
        const entity = this.stored.get(entityId);

        if (!entity) return false;

        // Determine pool
        const poolId = targetPoolId || entity.poolId || this.defaultPoolId;
        const pool = this.pools.get(poolId) || this.pools.get(this.defaultPoolId);

        // Deactivate and remove from tracking
        this.deactivate(entityId);
        this.stored.delete(entityId);
        this.active.delete(entityId);

        // Clear history for this entity
        this.history.delete(entityId);

        // Remove from all groups
        for (const group of this.groups.values()) {
            group.entities.delete(entityId);
        }

        pool.stats.inUse = Math.max(0, pool.stats.inUse - 1);
        pool.stats.totalReleased++;

        // Sync legacy stats for default pool
        if (poolId === this.defaultPoolId) {
            this.poolStats.inUse = pool.stats.inUse;
            this.poolStats.totalReleased = pool.stats.totalReleased;
        }

        // Add to pool if not full
        if (pool.entities.length < pool.config.maxSize) {
            // Clean up entity for pooling
            this._prepareEntityForPool(entity);
            entity.poolId = poolId;
            pool.entities.push(entity);
            pool.stats.available++;
            pool.stats.size = pool.entities.length;

            // Sync legacy stats
            if (poolId === this.defaultPoolId) {
                this.poolStats.available = pool.stats.available;
                this.poolStats.size = pool.stats.size;
            }

            this.emit('entityReleased', { entityId, toPool: true, poolId });

            // Schedule shrink check
            this._scheduleShrinkCheckForPool(poolId);

            return true;
        }

        this.emit('entityReleased', { entityId, toPool: false, poolId });
        return false;
    }

    /**
     * Move an entity from one pool to another.
     *
     * @param {Object|string} entityOrId - Entity or entity ID
     * @param {string} targetPoolId - Pool to move to
     * @returns {boolean} True if moved successfully
     * @fires EntityManager#entityMovedPool
     */
    moveToPool(entityOrId, targetPoolId) {
        const entityId = typeof entityOrId === 'string' ? entityOrId : entityOrId?.id;
        const entity = this.stored.get(entityId);

        if (!entity) return false;

        const targetPool = this.pools.get(targetPoolId);
        if (!targetPool) {
            console.warn(`Target pool '${targetPoolId}' not found.`);
            return false;
        }

        const fromPoolId = entity.poolId || this.defaultPoolId;
        if (fromPoolId === targetPoolId) return true; // Already in target pool

        const fromPool = this.pools.get(fromPoolId);

        // Update pool stats
        if (fromPool) {
            fromPool.stats.inUse = Math.max(0, fromPool.stats.inUse - 1);
        }
        targetPool.stats.inUse++;

        // Update entity's pool association
        entity.poolId = targetPoolId;

        this.emit('entityMovedPool', { entityId, fromPool: fromPoolId, toPool: targetPoolId });
        return true;
    }

    /**
     * Pre-warm a specific pool.
     *
     * @param {number} count - Number of entities to pre-create
     * @param {string} [presetId] - Preset to use
     * @param {string} [poolId] - Pool to warm (defaults to default)
     * @returns {EntityManager} This instance for chaining
     */
    preWarmPool(count, presetId = null, poolId = null) {
        const targetPoolId = poolId || this.defaultPoolId;
        const pool = this.pools.get(targetPoolId);

        if (!pool) {
            console.warn(`Pool '${targetPoolId}' not found.`);
            return this;
        }

        if (!this.spawnManager) {
            console.warn('EntityManager requires a linked SpawnManager for preWarmPool()');
            return this;
        }

        const toCreate = Math.min(count, pool.config.maxSize - pool.entities.length);

        for (let i = 0; i < toCreate; i++) {
            let entity;
            if (presetId) {
                entity = this.spawnManager.spawn(presetId);
            } else {
                entity = this.spawnManager.generate();
            }

            if (entity) {
                this._prepareEntityForPool(entity);
                entity.poolId = targetPoolId;
                pool.entities.push(entity);
                pool.stats.totalCreated++;
            }
        }

        pool.stats.size = pool.entities.length;
        pool.stats.available = pool.entities.length;

        // Sync legacy stats for default pool
        if (targetPoolId === this.defaultPoolId) {
            this.poolStats.size = pool.stats.size;
            this.poolStats.available = pool.stats.available;
            this.poolStats.totalCreated = pool.stats.totalCreated;
        }

        return this;
    }

    /**
     * Clear a specific pool.
     *
     * @param {string} [poolId] - Pool to clear (defaults to default)
     * @returns {EntityManager} This instance for chaining
     */
    clearPool(poolId = null) {
        const targetPoolId = poolId || this.defaultPoolId;
        const pool = this.pools.get(targetPoolId);

        if (!pool) return this;

        pool.entities.length = 0;
        pool.stats.size = 0;
        pool.stats.available = 0;

        if (pool._shrinkTimeout) {
            clearTimeout(pool._shrinkTimeout);
            pool._shrinkTimeout = null;
        }

        // Sync legacy references for default pool
        if (targetPoolId === this.defaultPoolId) {
            this.pool.length = 0;
            this.poolStats.size = 0;
            this.poolStats.available = 0;
        }

        return this;
    }

    /**
     * Get statistics for a specific pool.
     *
     * @param {string} [poolId] - Pool ID (defaults to default for backward compat)
     * @returns {Object} Pool statistics
     */
    getPoolStats(poolId = null) {
        const targetPoolId = poolId || this.defaultPoolId;
        const pool = this.pools.get(targetPoolId);

        if (!pool) {
            return { size: 0, available: 0, inUse: 0, totalAcquired: 0, totalReleased: 0, totalCreated: 0 };
        }

        return {
            ...pool.stats,
            size: pool.entities.length,
            available: pool.entities.length
        };
    }

    /**
     * Get statistics for all pools.
     *
     * @returns {Object} Map of poolId to stats
     */
    getAllPoolStats() {
        const stats = {};
        for (const [poolId, pool] of this.pools) {
            stats[poolId] = this.getPoolStats(poolId);
        }
        return stats;
    }

    /**
     * Set assignment rules for a pool.
     *
     * @param {string} poolId - Pool to configure
     * @param {Object} rules - Assignment rules
     * @param {Array<Object>} [rules.conditions] - Rule conditions
     * @param {string} [rules.fallback='default'] - Fallback pool if no match
     * @returns {EntityManager} This instance for chaining
     * @example
     * manager.setPoolRules('enemies', {
     *   conditions: [
     *     { source: 'preset', match: 'enemy_*' },
     *     { source: 'trait', match: 'hostile' }
     *   ]
     * });
     */
    setPoolRules(poolId, rules) {
        const pool = this.pools.get(poolId);
        if (!pool) {
            console.warn(`Pool '${poolId}' not found.`);
            return this;
        }

        pool.rules = rules;
        this.emit('poolRulesUpdated', { poolId, rules });
        return this;
    }

    /**
     * Determine which pool an entity should belong to based on rules.
     *
     * @param {Object} entity - Entity to evaluate
     * @returns {string} Pool ID the entity should belong to
     */
    getPoolForEntity(entity) {
        // 1. Check for explicit pool assignment
        if (entity.poolId && this.pools.has(entity.poolId)) {
            return entity.poolId;
        }

        // 2. Evaluate rules for each pool
        const matches = [];
        for (const [poolId, pool] of this.pools) {
            if (poolId === this.defaultPoolId || !pool.rules?.conditions) continue;

            const score = this._evaluatePoolRules(entity, pool.rules);
            if (score > 0) {
                matches.push({ poolId, score, priority: pool.rules.priority || 0 });
            }
        }

        // Sort by priority then score
        if (matches.length > 0) {
            matches.sort((a, b) => {
                if (a.priority !== b.priority) return b.priority - a.priority;
                return b.score - a.score;
            });
            return matches[0].poolId;
        }

        // 3. Fallback to default pool
        return this.defaultPoolId;
    }

    /**
     * Evaluate pool rules against an entity.
     * @private
     */
    _evaluatePoolRules(entity, rules) {
        if (!rules?.conditions || rules.conditions.length === 0) return 0;

        let score = 0;
        for (const condition of rules.conditions) {
            if (this._evaluatePoolCondition(entity, condition)) {
                score += condition.weight || 1;
            }
        }

        return score;
    }

    /**
     * Evaluate a single pool condition.
     * @private
     */
    _evaluatePoolCondition(entity, condition) {
        const { source, match, operator, value } = condition;

        switch (source) {
            case 'preset':
                // Match preset ID (supports glob-like * patterns)
                if (!entity.presetId) return false;
                return this._matchPattern(entity.presetId, match);

            case 'trait':
                // Check if entity has an active trait
                for (const layer of Object.values(entity.layers || {})) {
                    if (layer.active?.includes(match)) return true;
                }
                return false;

            case 'attribute':
                // Check attribute value
                const attrValue = entity.attributes?.[match];
                if (attrValue === undefined) return false;
                return this._evaluateOperator(attrValue, operator || 'eq', value);

            case 'variable':
                // Check variable value
                const varState = entity.variables?.[match];
                if (!varState) return false;
                return this._evaluateOperator(varState.value, operator || 'eq', value);

            case 'modifier':
                // Check if modifier is active
                return entity.modifiers?.some(m =>
                    typeof m === 'string' ? m === match : m.id === match
                );

            case 'compound':
                // Check if compound is active
                return entity.compounds?.some(c =>
                    typeof c === 'string' ? c === match : c.id === match
                );

            default:
                return false;
        }
    }

    /**
     * Match a string against a glob-like pattern.
     * @private
     */
    _matchPattern(str, pattern) {
        if (!pattern.includes('*')) return str === pattern;

        // Convert glob to regex
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(str);
    }

    /**
     * Evaluate a comparison operator.
     * @private
     */
    _evaluateOperator(value, operator, target) {
        switch (operator) {
            case 'eq': return value === target;
            case 'ne': return value !== target;
            case 'gt': return value > target;
            case 'gte': return value >= target;
            case 'lt': return value < target;
            case 'lte': return value <= target;
            default: return false;
        }
    }

    // ========================================
    // SERIALIZATION
    // ========================================

    export() {
        // Export pools (excluding entities array and timeout)
        const poolsExport = Array.from(this.pools.entries()).map(([id, pool]) => [id, {
            id: pool.id,
            name: pool.name,
            description: pool.description,
            config: { ...pool.config },
            stats: { ...pool.stats },
            rules: pool.rules ? JSON.parse(JSON.stringify(pool.rules)) : null
        }]);

        return {
            presets: Array.from(this.presets.entries()),
            groups: Array.from(this.groups.entries()).map(([id, g]) => [id, {
                ...g, entities: Array.from(g.entities)
            }]),
            stored: Array.from(this.stored.entries()),
            active: Array.from(this.active.keys()),
            spawnContext: this.spawnContext,
            config: this.config,
            pools: poolsExport
        };
    }

    import(data) {
        if (data.presets) this.presets = new Map(data.presets);
        if (data.groups) {
            this.groups = new Map(data.groups.map(([id, g]) => [id, {
                ...g, entities: new Set(g.entities)
            }]));
        }
        if (data.stored) this.stored = new Map(data.stored);
        if (data.active) {
            for (const entityId of data.active) {
                const entity = this.stored.get(entityId);
                if (entity) this.active.set(entityId, entity);
            }
        }
        if (data.spawnContext) this.spawnContext = data.spawnContext;
        if (data.config) this.config = { ...this.config, ...data.config };

        // Import pools
        if (data.pools) {
            for (const [poolId, poolData] of data.pools) {
                if (poolId === this.defaultPoolId) {
                    // Update default pool
                    const defaultPool = this.pools.get(this.defaultPoolId);
                    defaultPool.name = poolData.name || defaultPool.name;
                    defaultPool.description = poolData.description || '';
                    defaultPool.config = { ...defaultPool.config, ...poolData.config };
                    defaultPool.rules = poolData.rules || null;
                    // Sync legacy references
                    this.poolConfig = { ...defaultPool.config };
                } else {
                    // Create or update other pools
                    this.createPool(poolId, {
                        name: poolData.name,
                        description: poolData.description,
                        ...poolData.config,
                        rules: poolData.rules
                    });
                }
            }
        }

        this.emit('dataImported', { data });
        return this;
    }

    // ========================================
    // EVENTS
    // ========================================

    on(event, callback) {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event).add(callback);
        return () => this.off(event, callback);
    }

    off(event, callback) { this.listeners.get(event)?.delete(callback); }

    emit(event, data = {}) {
        this.listeners.get(event)?.forEach(cb => {
            try { cb(data); } catch (e) { console.error(`EntityManager event error (${event}):`, e); }
        });
    }
}


// ============================================================================
// SPAWN ENGINE - Convenience Wrapper (Backward Compatible)
// ============================================================================

/**
 * Main entry point combining SpawnManager and EntityManager into a unified API.
 * This is the recommended class for most use cases.
 *
 * Provides convenient methods for:
 * - Spawning entities (random or from presets)
 * - Managing entity lifecycle (activate, tick, despawn)
 * - Modifying runtime state (variables, modifiers, traits)
 * - Querying entity state
 * - Subscribing to events
 *
 * @class SpawnEngine
 * @example
 * // Create engine with config
 * const engine = new SpawnEngine(config);
 *
 * // Spawn entities
 * const entity = engine.spawn();
 * const warrior = engine.spawn('preset_warrior');
 *
 * // Tick in game loop
 * engine.tickAll(deltaTime);
 *
 * // Listen for events
 * engine.on('compoundActivated', (data) => {
 *   console.log('Compound activated:', data.compoundId);
 * });
 *
 * // Modify state
 * engine.modifyVariable(entity, 'var_hunger', -20);
 * engine.applyModifier(entity, 'mod_well_fed');
 *
 * // Query state
 * const state = engine.getState(entity.id);
 */
class SpawnEngine {
    /**
     * Create a new SpawnEngine instance.
     *
     * @param {Object|null} [config=null] - Configuration object to load
     * @example
     * const engine = new SpawnEngine(config);
     */
    constructor(config = null) {
        /** @type {SpawnManager} The SpawnManager for generation logic */
        this.spawnManager = new SpawnManager(config);
        /** @type {EntityManager} The EntityManager for runtime state */
        this.entityManager = new EntityManager();
        this.entityManager.linkSpawnManager(this.spawnManager);

        /** @type {Map<string, Object>} Internal entity storage for backward compatibility */
        this.entities = new Map();

        // Auto-load presets if config was provided
        if (config) {
            this._loadPresetsFromConfig();
        }
    }

    // ========================================
    // CONFIG (backward compatible)
    // ========================================

    loadConfig(config) {
        this.spawnManager.loadConfig(config);

        // Auto-register presets from config
        this._loadPresetsFromConfig();

        return this;
    }

    _loadPresetsFromConfig() {
        const cfg = this.spawnManager.config;
        if (!cfg) return;

        // Clear existing presets first (they may be from previous config)
        this.entityManager.presets.clear();
        this.entityManager.presetGroups.clear();

        // Register preset groups
        if (cfg.presetGroups && cfg.presetGroups.length > 0) {
            for (const group of cfg.presetGroups) {
                this.entityManager.presetGroups.set(group.id, {
                    id: group.id,
                    name: group.name || group.id,
                    description: group.description || ''
                });
            }
        }

        // Register presets
        if (cfg.presets && cfg.presets.length > 0) {
            for (const preset of cfg.presets) {
                this.entityManager.registerPreset(preset.id, preset);
            }
        }
    }

    get config() {
        return this.spawnManager.config;
    }

    // ========================================
    // GENERATION
    // ========================================

    /**
     * Spawn a new entity, optionally from a preset.
     *
     * @param {string|Object} [presetIdOrOverrides] - Preset ID or override object
     * @param {Object} [overrides={}] - Additional overrides when using preset
     * @param {Object} [overrides.attributes] - Attribute value overrides
     * @param {Object} [overrides.contexts] - Context value overrides
     * @param {string[]} [overrides.forceTraits] - Trait IDs to force-activate
     * @returns {Object} The spawned entity
     * @example
     * // Random generation
     * const entity = engine.spawn();
     *
     * // From preset
     * const patron = engine.spawn('preset_tavern_regular');
     *
     * // With overrides
     * const custom = engine.spawn({ attributes: { strength: 10 } });
     *
     * // Preset with overrides
     * const strong = engine.spawn('preset_warrior', { attributes: { strength: 10 } });
     */
    spawn(presetIdOrOverrides, overrides = {}) {
        let entity;

        if (presetIdOrOverrides === undefined) {
            // No args = random generation (backward compatible)
            entity = this.spawnManager.generate();
        } else if (typeof presetIdOrOverrides === 'string') {
            // String = preset ID
            entity = this.spawnManager.spawn(presetIdOrOverrides, overrides);
            if (!entity) {
                // Fallback to generate if preset not found
                entity = this.spawnManager.generate(overrides);
            }
        } else {
            // Object = overrides for generation
            entity = this.spawnManager.generate(presetIdOrOverrides);
        }

        if (entity) {
            this.entities.set(entity.id, entity);
            this.entityManager.store(entity);
            this.entityManager.activate(entity);
        }

        return entity;
    }

    generate(overrides = {}) {
        const entity = this.spawnManager.generate(overrides);
        if (entity) {
            this.entities.set(entity.id, entity);
            this.entityManager.store(entity);
        }
        return entity;
    }

    spawnWhere(query, overrides = {}) {
        const entity = this.spawnManager.spawnWhere(query, overrides);
        if (entity) {
            this.entities.set(entity.id, entity);
            this.entityManager.store(entity);
            this.entityManager.activate(entity);
        }
        return entity;
    }

    createSnapshot(overrides = {}) {
        return this.spawnManager.generate(overrides);
    }

    // ========================================
    // ENTITY ACCESS (backward compatible)
    // ========================================

    getEntity(entityId) {
        return this.entities.get(entityId) || this.entityManager.retrieve(entityId);
    }

    getAllEntities() {
        return Array.from(this.entities.values());
    }

    despawn(entityId) {
        this.entities.delete(entityId);
        return this.entityManager.remove(entityId);
    }

    register(entity) {
        if (!entity.id) {
            entity.id = `entity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }
        this.entities.set(entity.id, entity);
        this.entityManager.store(entity);
        return entity;
    }

    // ========================================
    // PRESETS & GROUPS
    // ========================================

    registerPreset(id, template) {
        this.entityManager.registerPreset(id, template);
        return this;
    }

    registerPresets(presets) {
        this.entityManager.registerPresets(presets);
        return this;
    }

    getPreset(id) { return this.entityManager.getPreset(id); }
    listPresets(filter) { return this.entityManager.listPresets(filter); }

    createGroup(groupId, metadata = {}) {
        this.entityManager.createGroup(groupId, metadata);
        return this;
    }

    addToGroup(groupId, entityId) {
        this.entityManager.addToGroup(groupId, entityId);
        return this;
    }

    getGroup(groupId) { return this.entityManager.getGroup(groupId); }
    listGroups() { return this.entityManager.listGroups(); }

    // ========================================
    // SPAWN CONTEXT
    // ========================================

    setSpawnContext(context) {
        this.entityManager.setSpawnContext(context);
        return this;
    }

    getSpawnContext() { return this.entityManager.getSpawnContext(); }

    // ========================================
    // RUNTIME (backward compatible)
    // ========================================

    tick(entityOrId, deltaSeconds = null) {
        const entity = typeof entityOrId === 'string' ? this.getEntity(entityOrId) : entityOrId;
        if (!entity) return null;

        // Ensure entity is active for ticking
        if (!this.entityManager.isActive(entity.id)) {
            this.entityManager.activate(entity);
        }

        return this.entityManager.tick(entity.id, deltaSeconds);
    }

    tickAll(deltaSeconds = null) {
        // Activate all entities for ticking
        for (const entity of this.entities.values()) {
            if (!this.entityManager.isActive(entity.id)) {
                this.entityManager.activate(entity);
            }
        }
        this.entityManager.tickAll(deltaSeconds);
    }

    startAutoTick() {
        this.entityManager.startAutoTick(this.config.engineConfig.tickRate);
    }

    stopAutoTick() {
        this.entityManager.stopAutoTick();
    }

    modifyVariable(entity, varId, delta) {
        const entityObj = typeof entity === 'string' ? this.getEntity(entity) : entity;
        if (!entityObj) return false;
        return this.entityManager.modifyVariable(entityObj.id, varId, delta);
    }

    setVariable(entity, varId, value) {
        const entityObj = typeof entity === 'string' ? this.getEntity(entity) : entity;
        if (!entityObj) return false;
        return this.entityManager.setVariable(entityObj.id, varId, value);
    }

    applyModifier(entity, modifierId) {
        const entityObj = typeof entity === 'string' ? this.getEntity(entity) : entity;
        if (!entityObj) return false;

        const modifier = this.spawnManager.getNode(modifierId);
        const config = modifier?.config || {};

        return this.entityManager.applyModifier(entityObj.id, modifierId, config);
    }

    removeModifier(entity, modifierId) {
        const entityObj = typeof entity === 'string' ? this.getEntity(entity) : entity;
        if (!entityObj) return false;
        return this.entityManager.removeModifier(entityObj.id, modifierId);
    }

    activateTrait(entity, traitId) {
        const entityObj = typeof entity === 'string' ? this.getEntity(entity) : entity;
        if (!entityObj) return false;
        return this.entityManager.activateTrait(entityObj.id, traitId);
    }

    // Backward compatibility alias
    activateItem(entity, itemId) {
        return this.activateTrait(entity, itemId);
    }

    deactivateTrait(entity, traitId) {
        const entityObj = typeof entity === 'string' ? this.getEntity(entity) : entity;
        if (!entityObj) return false;
        return this.entityManager.deactivateTrait(entityObj.id, traitId);
    }

    // Backward compatibility alias
    deactivateItem(entity, itemId) {
        return this.deactivateTrait(entity, itemId);
    }

    // ========================================
    // STATE
    // ========================================

    getState(entityId) {
        return this.entityManager.getState(entityId);
    }

    snapshot(entityId) { return this.entityManager.snapshot(entityId); }
    getHistory(entityId) { return this.entityManager.getHistory(entityId); }
    rollback(entityId, timestamp) { return this.entityManager.rollback(entityId, timestamp); }
    query(filter) { return this.entityManager.query(filter); }

    // ========================================
    // NODE QUERIES (backward compatible)
    // ========================================

    getNode(nodeId) { return this.spawnManager.getNode(nodeId); }
    getNodesByType(type) { return this.spawnManager.getNodesByType(type); }
    getAttributes() { return this.spawnManager.getAttributes(); }
    getVariables() { return this.spawnManager.getVariables(); }
    getContexts() { return this.spawnManager.getContexts(); }
    getLayers() { return this.spawnManager.getLayers(); }
    getLayerTraits(layerId) { return this.spawnManager.getLayerTraits(layerId); }
    getLayerItems(layerId) { return this.spawnManager.getLayerTraits(layerId); }
    getTraits() { return this.spawnManager.getTraits(); }
    getModifiers() { return this.spawnManager.getModifiers(); }
    getCompounds() { return this.spawnManager.getCompounds(); }
    getDerived() { return this.spawnManager.getDerived(); }
    getActions() { return this.spawnManager.getActions(); }
    getNodesByTaxonomy(filter) { return this.spawnManager.getNodesByTaxonomy(filter); }
    getTaxonomyValues(level) { return this.spawnManager.getTaxonomyValues(level); }

    // ========================================
    // ACTION SYSTEM
    // ========================================

    /**
     * Check if an action is available for an entity.
     * @param {string|Object} entityOrId - Entity or entity ID
     * @param {string} actionId - Action ID
     * @returns {boolean}
     */
    isActionAvailable(entityOrId, actionId) {
        const entity = typeof entityOrId === 'string'
            ? this.entityManager.getEntity(entityOrId)
            : entityOrId;
        return this.spawnManager.isActionAvailable(entity, actionId);
    }

    /**
     * Get all available actions for an entity.
     * @param {string|Object} entityOrId - Entity or entity ID
     * @returns {Array<{id, weight, action}>}
     */
    getAvailableActions(entityOrId) {
        const entity = typeof entityOrId === 'string'
            ? this.entityManager.getEntity(entityOrId)
            : entityOrId;
        return this.spawnManager.getAvailableActions(entity);
    }

    /**
     * Select an action using weighted random.
     * @param {string|Object} entityOrId - Entity or entity ID
     * @returns {Object|null} {id, weight, action} or null
     */
    selectAction(entityOrId) {
        const entity = typeof entityOrId === 'string'
            ? this.entityManager.getEntity(entityOrId)
            : entityOrId;
        return this.spawnManager.selectAction(entity);
    }

    /**
     * Execute an action, deducting costs and starting cooldown.
     * @param {string|Object} entityOrId - Entity or entity ID
     * @param {string} actionId - Action ID
     * @returns {Object} {success, actionId, effects, action} or {success: false, reason}
     */
    executeAction(entityOrId, actionId) {
        const entity = typeof entityOrId === 'string'
            ? this.entityManager.getEntity(entityOrId)
            : entityOrId;
        return this.spawnManager.executeAction(entity, actionId);
    }

    /**
     * Get action cooldown status.
     * @param {string|Object} entityOrId - Entity or entity ID
     * @param {string} actionId - Action ID
     * @returns {Object} {cooldownRemaining, cooldownTotal, ready}
     */
    getActionCooldown(entityOrId, actionId) {
        const entity = typeof entityOrId === 'string'
            ? this.entityManager.getEntity(entityOrId)
            : entityOrId;
        return this.spawnManager.getActionCooldown(entity, actionId);
    }

    // ========================================
    // OUTCOME LAYERS
    // ========================================

    /**
     * Roll an outcome layer - clears previous results and rolls fresh.
     * Use for layers with timing.rollAt = 'manual', like attack/defense outcomes.
     * @param {string|Object} entityOrId - Entity or entity ID
     * @param {string} layerId - The layer to roll
     * @param {number} [rolls=1] - Number of times to roll
     * @returns {Object} {success, selected, previousActive, layerId}
     * @example
     * // Define attack outcome layer with timing.rollAt = 'manual'
     * // Then roll outcomes during combat
     * const result = engine.rollOutcome(attacker, 'layer_attack_outcome');
     * if (result.selected.includes('item_critical')) {
     *   damage *= 2;
     * }
     */
    rollOutcome(entityOrId, layerId, rolls = 1) {
        const entity = typeof entityOrId === 'string'
            ? this.entityManager.getEntity(entityOrId)
            : entityOrId;
        return this.spawnManager.rollOutcome(entity, layerId, rolls);
    }

    /**
     * Roll a layer and add to existing active items (doesn't clear first).
     * @param {string|Object} entityOrId - Entity or entity ID
     * @param {string} layerId - The layer to roll
     * @returns {Object} Roll result
     */
    rollLayer(entityOrId, layerId) {
        const entity = typeof entityOrId === 'string'
            ? this.entityManager.getEntity(entityOrId)
            : entityOrId;
        return this.spawnManager.rollLayer(entity, layerId);
    }

    // ========================================
    // RELATIONSHIP QUERIES (backward compatible)
    // ========================================

    getRelationshipsFrom(nodeId) { return this.spawnManager.getRelationshipsFrom(nodeId); }
    getRelationshipsTo(nodeId) { return this.spawnManager.getRelationshipsTo(nodeId); }
    getRelationshipsByType(type) { return this.spawnManager.getRelationshipsByType(type); }

    // ========================================
    // ANALYSIS
    // ========================================

    getWeights(entity, layerId) { return this.spawnManager.getWeights(entity, layerId); }
    previewInfluences(nodeId) { return this.spawnManager.previewInfluences(nodeId); }

    // ========================================
    // EVENTS
    // ========================================

    on(event, callback) {
        return this.entityManager.on(event, callback);
    }

    emit(event, data) {
        this.entityManager.emit(event, data);
    }

    // ========================================
    // SERIALIZATION
    // ========================================

    exportEntity(entityId) {
        const entity = this.getEntity(entityId);
        if (!entity) return null;
        return JSON.parse(JSON.stringify(entity));
    }

    importEntity(data) {
        const entity = JSON.parse(JSON.stringify(data));
        this.entities.set(entity.id, entity);
        this.entityManager.store(entity);
        return entity.id;
    }

    export() {
        return {
            config: this.spawnManager.config,
            entityManager: this.entityManager.export()
        };
    }

    import(data) {
        if (data.config) this.spawnManager.loadConfig(data.config);
        if (data.entityManager) this.entityManager.import(data.entityManager);
        return this;
    }

    // ========================================
    // ENTITY POOLING
    // ========================================

    /**
     * Configure the entity pool for high-frequency spawn/despawn scenarios.
     *
     * @param {Object} config - Pool configuration
     * @param {number} [config.maxSize=100] - Maximum entities to keep in pool
     * @param {number} [config.preWarm=0] - Number of entities to pre-create
     * @param {string} [config.preWarmPreset=null] - Preset to use for pre-warming
     * @returns {SpawnEngine} This instance for chaining
     * @example
     * // Setup for JRPG combat
     * engine.configurePool({
     *   maxSize: 50,
     *   preWarm: 10,
     *   preWarmPreset: 'enemy_basic'
     * });
     *
     * // Combat loop
     * const enemy = engine.acquire('enemy_goblin');
     * // ... combat ...
     * engine.release(enemy);
     */
    configurePool(config) {
        this.entityManager.configurePool(config);
        return this;
    }

    /**
     * Acquire an entity from pool or create new.
     * Faster than spawn() for frequent spawn/despawn patterns.
     *
     * @param {string|Object} [presetIdOrOverrides] - Preset ID or overrides
     * @param {Object} [overrides={}] - Additional overrides
     * @returns {Object} The acquired entity (active and ready to use)
     * @example
     * // Start combat encounter
     * const enemies = [
     *   engine.acquire('enemy_goblin'),
     *   engine.acquire('enemy_goblin'),
     *   engine.acquire('enemy_orc', { attributes: { strength: 15 } })
     * ];
     */
    acquire(presetIdOrOverrides, overrides = {}) {
        const entity = this.entityManager.acquire(presetIdOrOverrides, overrides);
        if (entity) {
            this.entities.set(entity.id, entity);
        }
        return entity;
    }

    /**
     * Release an entity back to the pool for reuse.
     *
     * @param {Object|string} entityOrId - Entity or entity ID
     * @returns {boolean} True if released to pool
     * @example
     * // Enemy defeated
     * engine.release(enemy);
     *
     * // Release all enemies after combat
     * enemies.forEach(e => engine.release(e));
     */
    release(entityOrId) {
        const entityId = typeof entityOrId === 'string' ? entityOrId : entityOrId?.id;
        this.entities.delete(entityId);
        return this.entityManager.release(entityOrId);
    }

    /**
     * Pre-warm the pool with entities.
     *
     * @param {number} count - Number of entities to pre-create
     * @param {string} [presetId] - Preset to use
     * @param {string} [poolId] - Target pool (defaults to default)
     * @returns {SpawnEngine} This instance for chaining
     * @example
     * // Before wave-based combat
     * engine.preWarmPool(30, 'enemy_basic');
     *
     * // Pre-warm specific pool
     * engine.preWarmPool(20, 'goblin', 'enemies');
     */
    preWarmPool(count, presetId = null, poolId = null) {
        this.entityManager.preWarmPool(count, presetId, poolId);
        return this;
    }

    /**
     * Get current pool statistics.
     *
     * @param {string} [poolId] - Pool ID (defaults to default pool)
     * @returns {Object} Pool stats (size, available, inUse, totals)
     */
    getPoolStats(poolId = null) {
        return this.entityManager.getPoolStats(poolId);
    }

    // ========================================
    // MULTI-POOL MANAGEMENT
    // ========================================

    /**
     * Create a new named entity pool.
     *
     * @param {string} poolId - Unique pool identifier
     * @param {Object} [options={}] - Pool configuration
     * @returns {Object} The created pool instance
     * @example
     * engine.createPool('enemies', {
     *   name: 'Enemy Pool',
     *   maxSize: 50,
     *   preWarm: 10,
     *   preWarmPreset: 'goblin',
     *   rules: { conditions: [{ source: 'preset', match: 'enemy_*' }] }
     * });
     */
    createPool(poolId, options = {}) {
        return this.entityManager.createPool(poolId, options);
    }

    /**
     * Get a pool by ID.
     *
     * @param {string} poolId - Pool identifier
     * @returns {Object|null} The pool instance or null
     */
    getPool(poolId) {
        return this.entityManager.getPool(poolId);
    }

    /**
     * List all pools.
     *
     * @returns {Array<Object>} Array of pool summaries
     */
    listPools() {
        return this.entityManager.listPools();
    }

    /**
     * Remove a pool. Entities are moved to default pool.
     *
     * @param {string} poolId - Pool to remove
     * @returns {boolean} True if removed
     */
    removePool(poolId) {
        return this.entityManager.removePool(poolId);
    }

    /**
     * Move an entity to a different pool.
     *
     * @param {Object|string} entityOrId - Entity or entity ID
     * @param {string} targetPoolId - Target pool
     * @returns {boolean} True if moved
     */
    moveToPool(entityOrId, targetPoolId) {
        return this.entityManager.moveToPool(entityOrId, targetPoolId);
    }

    /**
     * Set assignment rules for a pool.
     *
     * @param {string} poolId - Pool to configure
     * @param {Object} rules - Assignment rules
     * @returns {SpawnEngine} This instance for chaining
     */
    setPoolRules(poolId, rules) {
        this.entityManager.setPoolRules(poolId, rules);
        return this;
    }

    /**
     * Determine which pool an entity should belong to.
     *
     * @param {Object} entity - Entity to evaluate
     * @returns {string} Pool ID
     */
    getPoolForEntity(entity) {
        return this.entityManager.getPoolForEntity(entity);
    }

    /**
     * Get statistics for all pools.
     *
     * @returns {Object} Map of poolId to stats
     */
    getAllPoolStats() {
        return this.entityManager.getAllPoolStats();
    }

    /**
     * Clear a specific pool.
     *
     * @param {string} [poolId] - Pool to clear (defaults to default)
     * @returns {SpawnEngine} This instance for chaining
     */
    clearPool(poolId = null) {
        this.entityManager.clearPool(poolId);
        return this;
    }
}


// ============================================================================
// CSV IMPORTER
// ============================================================================

class CSVImporter {
    /**
     * Parse CSV string into array of objects.
     */
    static parse(csvString, options = {}) {
        const delimiter = options.delimiter || ',';
        const lines = csvString.trim().split(/\r?\n/);

        if (lines.length < 2) return [];

        const headers = this.parseLine(lines[0], delimiter);
        const rows = [];

        for (let i = 1; i < lines.length; i++) {
            const values = this.parseLine(lines[i], delimiter);
            if (values.length === 0 || (values.length === 1 && values[0] === '')) continue;

            const row = {};
            for (let j = 0; j < headers.length; j++) {
                const header = headers[j].trim();
                let value = values[j]?.trim() || '';

                // Auto-convert types
                if (value === 'true') value = true;
                else if (value === 'false') value = false;
                else if (value !== '' && !isNaN(value)) value = parseFloat(value);

                row[header] = value;
            }
            rows.push(row);
        }

        return rows;
    }

    static parseLine(line, delimiter) {
        const values = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === delimiter && !inQuotes) {
                values.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current);

        return values;
    }

    /**
     * Import attributes from CSV.
     * Expected columns: id, name, description, min, max, default_min, default_max, precision
     */
    static importAttributes(csvString, config) {
        const rows = this.parse(csvString);
        const nodes = [];

        for (const row of rows) {
            if (!row.id) continue;

            nodes.push({
                id: row.id,
                name: row.name || row.id,
                description: row.description || '',
                type: 'attribute',
                config: {
                    min: row.min ?? 0,
                    max: row.max ?? 100,
                    defaultRange: [row.default_min ?? row.min ?? 0, row.default_max ?? row.max ?? 100],
                    precision: row.precision ?? 0
                }
            });
        }

        config.nodes = config.nodes.filter(n => n.type !== 'attribute');
        config.nodes.push(...nodes);

        return nodes;
    }

    /**
     * Import variables from CSV.
     * Expected columns: id, name, description, min, max, initial, base_rate, change_mode, direction
     */
    static importVariables(csvString, config) {
        const rows = this.parse(csvString);
        const nodes = [];

        for (const row of rows) {
            if (!row.id) continue;

            nodes.push({
                id: row.id,
                name: row.name || row.id,
                description: row.description || '',
                type: 'variable',
                config: {
                    min: row.min ?? 0,
                    max: row.max ?? 100,
                    initial: row.initial ?? row.max ?? 100,
                    baseRate: row.base_rate ?? 0,
                    changeMode: row.change_mode || 'manual',
                    direction: row.direction || 'none'
                }
            });
        }

        config.nodes = config.nodes.filter(n => n.type !== 'variable');
        config.nodes.push(...nodes);

        return nodes;
    }

    /**
     * Import traits from CSV.
     * Expected columns: id, name, description, layer, base_weight
     */
    static importTraits(csvString, config) {
        const rows = this.parse(csvString);
        const nodes = [];
        const layerTraits = new Map();

        for (const row of rows) {
            if (!row.id || !row.layer) continue;

            nodes.push({
                id: row.id,
                name: row.name || row.id,
                description: row.description || '',
                type: 'trait',
                config: {
                    layerId: row.layer,
                    selection: {
                        baseWeight: row.base_weight ?? 20
                    }
                }
            });

            if (!layerTraits.has(row.layer)) {
                layerTraits.set(row.layer, []);
            }
            layerTraits.get(row.layer).push(row.id);
        }

        // Remove existing traits and add new ones
        config.nodes = config.nodes.filter(n => n.type !== 'trait' && n.type !== 'item');
        config.nodes.push(...nodes);

        // Update layer traitIds
        for (const [layerId, traitIds] of layerTraits) {
            const layer = config.nodes.find(n => n.id === layerId && n.type === 'layer');
            if (layer) {
                layer.config.traitIds = traitIds;
            }
        }

        return nodes;
    }

    /**
     * Import layers from CSV.
     * Expected columns: id, name, description, order, selection_mode, max_items, initial_rolls, roll_at
     */
    static importLayers(csvString, config) {
        const rows = this.parse(csvString);
        const nodes = [];

        for (const row of rows) {
            if (!row.id) continue;

            nodes.push({
                id: row.id,
                name: row.name || row.id,
                description: row.description || '',
                type: 'layer',
                config: {
                    order: row.order ?? 0,
                    selection: {
                        mode: row.selection_mode || 'weighted',
                        maxItems: row.max_items ?? 10,
                        initialRolls: row.initial_rolls ?? 1
                    },
                    timing: {
                        rollAt: row.roll_at || 'spawn'
                    },
                    traitIds: []
                }
            });
        }

        config.nodes = config.nodes.filter(n => n.type !== 'layer');
        config.nodes.push(...nodes);

        return nodes;
    }

    /**
     * Import presets from CSV.
     * Expected columns: id, name, description, tags, force_traits, [attribute columns...]
     */
    static importPresets(csvString, entityManager) {
        const rows = this.parse(csvString);
        const presets = [];

        for (const row of rows) {
            if (!row.id) continue;

            const preset = {
                id: row.id,
                name: row.name || row.id,
                description: row.description || '',
                tags: row.tags ? row.tags.split('|').map(t => t.trim()) : [],
                forceTraits: row.force_traits ? row.force_traits.split('|').map(t => t.trim()) : [],
                attributes: {}
            };

            // Collect attribute overrides (any column starting with 'attr_')
            for (const [key, value] of Object.entries(row)) {
                if (key.startsWith('attr_') && typeof value === 'number') {
                    preset.attributes[key] = value;
                }
            }

            presets.push(preset);
            entityManager.registerPreset(row.id, preset);
        }

        return presets;
    }

    /**
     * Import relationships from CSV.
     * Expected columns: id, source, target, type, operation, value, scaling, per_point_source
     */
    static importRelationships(csvString, config) {
        const rows = this.parse(csvString);
        const relationships = [];

        for (const row of rows) {
            if (!row.source || !row.target || !row.type) continue;

            relationships.push({
                id: row.id || `rel_${row.source}_${row.target}`,
                sourceId: row.source,
                targetId: row.target,
                type: row.type,
                config: {
                    operation: row.operation || 'add',
                    value: row.value ?? 0,
                    scaling: row.scaling || 'flat',
                    perPointSource: row.per_point_source || null
                }
            });
        }

        config.relationships = config.relationships.filter(r =>
            !relationships.find(nr => nr.id === r.id)
        );
        config.relationships.push(...relationships);

        return relationships;
    }
}


// ============================================================================
// EXPORTS
// ============================================================================

// Browser globals
if (typeof window !== 'undefined') {
    window.SpawnEngine = SpawnEngine;
    window.SpawnManager = SpawnManager;
    window.EntityManager = EntityManager;
    window.CSVImporter = CSVImporter;
}

// Node.js exports
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SpawnEngine, SpawnManager, EntityManager, CSVImporter };
}
