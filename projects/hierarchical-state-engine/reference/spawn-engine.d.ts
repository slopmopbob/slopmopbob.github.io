/**
 * Spawn Engine v3 - TypeScript Definitions
 *
 * A configurable hierarchical state engine for generating entities with
 * layered traits, dynamic variables, and emergent compound states.
 *
 * @module SpawnEngine
 * @version 3.0
 */

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

export interface SpawnConfig {
    id: string;
    name: string;
    version?: string;
    description?: string;
    nodes: NodeDefinition[];
    relationships?: RelationshipDefinition[];
    presets?: PresetDefinition[];
    presetGroups?: PresetGroupDefinition[];
    engineConfig?: EngineConfig;
}

export interface EngineConfig {
    tickRate?: number;
    maxSpawns?: number | null;
    maxHistory?: number;
    maxEntities?: number | null;
}

export type NodeType = 'attribute' | 'variable' | 'context' | 'layer' | 'trait' | 'item' | 'modifier' | 'compound' | 'derived';

export interface NodeDefinition {
    id: string;
    name: string;
    description?: string;
    type: NodeType;
    config: NodeConfig;
}

export interface NodeConfig {
    // Attribute config
    min?: number;
    max?: number;
    defaultRange?: [number, number];
    precision?: number;

    // Variable config
    initial?: number;
    baseRate?: number;
    changeMode?: 'manual' | 'timed';
    direction?: 'none' | 'accumulate' | 'deplete';

    // Layer config
    order?: number;
    selection?: LayerSelection;
    timing?: LayerTiming;
    traitIds?: string[];
    itemIds?: string[];

    // Trait/Item config
    layerId?: string;
    incompatibleWith?: string[];
    eligibility?: Condition[];

    // Modifier config
    durationType?: 'permanent' | 'timed' | 'triggered';
    duration?: number;
    stacking?: 'ignore' | 'refresh' | 'stack';
    maxStacks?: number;

    // Compound config
    requires?: CompoundRequirement[];
    requirementLogic?: 'all' | 'any';

    // Derived config
    formula?: string;
}

export interface LayerSelection {
    mode?: 'weighted' | 'threshold' | 'pickN' | 'allMatching' | 'firstMatch';
    maxItems?: number;
    initialRolls?: number;
    baseWeight?: number;
    trigger?: ThresholdTrigger;
    autoRemove?: ThresholdTrigger;
}

export interface LayerTiming {
    rollAt?: 'spawn' | 'create' | 'never' | 'manual';
    rerollAllowed?: boolean;
    cooldown?: number;
}

export interface ThresholdTrigger {
    target: string;
    operator: '<' | '<=' | '>' | '>=' | '==' | '!=';
    value: number;
}

export interface CompoundRequirement {
    item?: string;
    trait?: string;
    modifier?: string;
    compound?: string;
    condition?: Condition;
}

export interface Condition {
    type?: 'attribute' | 'variable' | 'trait' | 'modifier' | 'compound' | 'context';
    target?: string;
    operator?: '<' | '<=' | '>' | '>=' | '==' | '!=';
    value?: number | string | boolean;
    nodeId?: string;
    all?: Condition[];
    any?: Condition[];
    not?: Condition;
}

export type RelationshipType = 'weight_influence' | 'rate_modifier' | 'value_modifier' | 'eligibility_gate' | 'requires' | 'replaces';

export interface RelationshipDefinition {
    id: string;
    sourceId: string;
    targetId: string;
    type: RelationshipType;
    config: RelationshipConfig;
    conditions?: Condition[];
}

export interface RelationshipConfig {
    operation?: 'add' | 'multiply' | 'set';
    value?: number;
    scaling?: 'flat' | 'perPoint';
    perPointSource?: string;
    applyAt?: 'spawn' | 'always';
}

export interface PresetDefinition {
    id: string;
    name?: string;
    description?: string;
    group?: string;
    tags?: string[];
    attributes?: Record<string, number>;
    contexts?: Record<string, any>;
    forceTraits?: string[];
}

export interface PresetGroupDefinition {
    id: string;
    name?: string;
    description?: string;
}

// ============================================================================
// ENTITY TYPES
// ============================================================================

export interface Entity {
    id: string;
    configId: string;
    createdAt: number;
    name?: string;
    presetId?: string;

    attributes: Record<string, number>;
    variables: Record<string, VariableState>;
    contexts: Record<string, any>;
    layers: Record<string, LayerState>;
    modifiers: string[];
    compounds: string[];
    derived: Record<string, number>;

    _internal: EntityInternals;
    _modifierStates: Record<string, ModifierState>;
}

export interface VariableState {
    value: number;
    baseRate: number;
    currentRate: number;
    min: number;
    max: number;
    changeMode: 'manual' | 'timed';
    direction: 'none' | 'accumulate' | 'deplete';
}

export interface LayerState {
    active: string[];
    lastRoll: number | null;
}

export interface ModifierState {
    appliedAt: number;
    expiresAt: number | null;
    stacks: number;
    config: NodeConfig;
}

export interface EntityInternals {
    log: LogEntry[];
    lastTick: number;
}

export interface LogEntry {
    timestamp: number;
    type: string;
    message: string;
    data?: any;
}

export interface EntitySnapshot {
    timestamp: number;
    state: Entity;
}

export interface EntityState {
    id: string;
    attributes: Record<string, number>;
    variables: Record<string, { value: number; rate: number }>;
    activeTraits: string[];
    activeModifiers: string[];
    activeCompounds: string[];
    derived: Record<string, number>;
}

// ============================================================================
// RESULT TYPES
// ============================================================================

export interface SelectionResult {
    success: boolean;
    selected?: string[];
    error?: string;
    pool?: WeightedItem[];
}

export interface WeightedItem {
    id: string;
    name: string;
    baseWeight: number;
    finalWeight: number;
    influences: WeightInfluence[];
}

export interface WeightInfluence {
    sourceId: string;
    sourceName: string;
    operation: string;
    value: number;
    delta: number;
}

export interface InfluencePreview {
    node: NodeDefinition;
    outgoing: RelationshipDefinition[];
    incoming: RelationshipDefinition[];
}

// ============================================================================
// EVENT TYPES
// ============================================================================

export type EventType =
    | 'entitySpawned'
    | 'entityStored'
    | 'entityActivated'
    | 'entityDeactivated'
    | 'entityRemoved'
    | 'variableChanged'
    | 'modifierApplied'
    | 'modifierRemoved'
    | 'traitActivated'
    | 'traitDeactivated'
    | 'compoundActivated'
    | 'compoundDeactivated'
    | 'tick'
    | 'autoTickStarted'
    | 'autoTickStopped'
    | 'snapshotTaken'
    | 'entityRolledBack'
    | 'spawnContextUpdated'
    | 'presetRegistered'
    | 'groupCreated'
    | 'addedToGroup'
    | 'entityAcquired'
    | 'entityReleased';

export interface EventData {
    entityId?: string;
    entity?: Entity;
    variableId?: string;
    oldValue?: number;
    newValue?: number;
    modifierId?: string;
    traitId?: string;
    compoundId?: string;
    deltaSeconds?: number;
    timestamp?: number;
    groupId?: string;
    fromPool?: boolean;
}

export type EventCallback = (data: EventData) => void;

// ============================================================================
// QUERY TYPES
// ============================================================================

export interface QueryFilter {
    attributes?: Record<string, { min?: number; max?: number; equals?: number }>;
    variables?: Record<string, { min?: number; max?: number; equals?: number }>;
    traits?: string[];
    modifiers?: string[];
    compounds?: string[];
    groups?: string[];
}

export interface PresetFilter {
    group?: string;
    tags?: string[];
    search?: string;
}

// ============================================================================
// POOL TYPES
// ============================================================================

export interface PoolConfig {
    maxSize?: number;
    preWarm?: number;
    preWarmPreset?: string | null;
    shrinkThreshold?: number;
    shrinkDelay?: number;
}

export interface PoolStats {
    size: number;
    available: number;
    inUse: number;
    totalAcquired: number;
    totalReleased: number;
    totalCreated: number;
}

export interface PoolInstance {
    id: string;
    name: string;
    description: string;
    config: PoolConfig;
    stats: PoolStats;
    entities: Entity[];
    rules: PoolRules | null;
}

export interface PoolRules {
    conditions: PoolCondition[];
    priority?: number;
    fallback?: string;
}

export interface PoolCondition {
    source: 'preset' | 'trait' | 'attribute' | 'variable' | 'modifier' | 'compound';
    match: string;
    operator?: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';
    value?: number;
    weight?: number;
}

export interface PoolSummary {
    id: string;
    name: string;
    description: string;
    stats: PoolStats;
    hasRules: boolean;
}

export interface PoolCreateOptions extends PoolConfig {
    name?: string;
    description?: string;
    rules?: PoolRules;
}

// ============================================================================
// SPAWN MANAGER
// ============================================================================

export declare class SpawnManager {
    config: SpawnConfig | null;
    nodeIndex: Map<string, NodeDefinition>;
    relationshipIndex: {
        bySource: Map<string, RelationshipDefinition[]>;
        byTarget: Map<string, RelationshipDefinition[]>;
        byType: Map<string, RelationshipDefinition[]>;
    };
    entityManager: EntityManager | null;

    constructor(config?: SpawnConfig | null);

    linkEntityManager(entityManager: EntityManager): this;
    loadConfig(config: SpawnConfig): this;

    // Generation
    generate(overrides?: Partial<GenerateOverrides>): Entity;
    spawn(presetId: string, overrides?: Partial<GenerateOverrides>): Entity | null;
    spawnWhere(query: QueryFilter, overrides?: Partial<GenerateOverrides>): Entity | null;

    // Node queries
    getNode(nodeId: string): NodeDefinition | null;
    getNodesByType(type: NodeType): NodeDefinition[];
    getAttributes(): NodeDefinition[];
    getVariables(): NodeDefinition[];
    getContexts(): NodeDefinition[];
    getLayers(): NodeDefinition[];
    getLayerTraits(layerId: string): NodeDefinition[];
    getTraits(): NodeDefinition[];
    getModifiers(): NodeDefinition[];
    getCompounds(): NodeDefinition[];
    getDerived(): NodeDefinition[];

    // Relationship queries
    getRelationshipsFrom(nodeId: string): RelationshipDefinition[];
    getRelationshipsTo(nodeId: string): RelationshipDefinition[];
    getRelationshipsByType(type: RelationshipType): RelationshipDefinition[];

    // Trait operations
    activateTrait(entity: Entity, traitId: string): boolean;
    deactivateTrait(entity: Entity, traitId: string): boolean;
    forceActivateTrait(entity: Entity, traitId: string): boolean;
    rollLayer(entity: Entity, layerId: string): SelectionResult;

    // Selection
    selectWeighted(entity: Entity, layerId: string): SelectionResult;
    selectPickN(entity: Entity, layerId: string, n: number): SelectionResult;
    selectAllMatching(entity: Entity, layerId: string): SelectionResult;
    selectFirstMatch(entity: Entity, layerId: string): SelectionResult;

    // Calculations
    calculateWeight(entity: Entity, trait: NodeDefinition): number;
    calculateDerived(entity: Entity): void;
    recalculateRates(entity: Entity): void;
    checkCompounds(entity: Entity): void;

    // Analysis
    getWeights(entity: Entity, layerId: string): WeightedItem[];
    previewInfluences(nodeId: string): InfluencePreview;

    // Conditions
    evaluateCondition(entity: Entity, condition: Condition): boolean;
    isNodeActive(entity: Entity, nodeId: string): boolean;
    isTrait(node: NodeDefinition): boolean;
}

export interface GenerateOverrides {
    attributes: Record<string, number>;
    contexts: Record<string, any>;
    forceTraits: string[];
}

// ============================================================================
// ENTITY MANAGER
// ============================================================================

export declare class EntityManager {
    spawnManager: SpawnManager | null;
    presets: Map<string, PresetDefinition>;
    presetGroups: Map<string, PresetGroupDefinition>;
    groups: Map<string, EntityGroup>;
    stored: Map<string, Entity>;
    active: Map<string, Entity>;
    history: Map<string, EntitySnapshot[]>;
    spawnContext: Record<string, any>;
    config: EngineConfig;
    tickInterval: number | null;
    listeners: Map<EventType, Set<EventCallback>>;

    // Pool properties (multi-pool)
    pools: Map<string, PoolInstance>;
    defaultPoolId: string;

    // Legacy pool properties (for backward compatibility)
    pool: Entity[];
    poolConfig: PoolConfig;
    poolStats: PoolStats;

    constructor(spawnManager?: SpawnManager | null);

    linkSpawnManager(spawnManager: SpawnManager): this;

    // Presets
    registerPreset(id: string, template: PresetDefinition): this;
    registerPresets(presets: Record<string, PresetDefinition>): this;
    getPreset(id: string): PresetDefinition | null;
    listPresets(filter?: PresetFilter): PresetDefinition[];
    removePreset(id: string): boolean;

    // Preset groups
    registerPresetGroup(id: string, metadata?: Partial<PresetGroupDefinition>): this;
    getPresetGroup(id: string): PresetGroupDefinition | null;
    listPresetGroups(): PresetGroupDefinition[];
    listPresetsByGroup(groupId: string): PresetDefinition[];
    removePresetGroup(id: string): boolean;

    // Entity groups
    createGroup(groupId: string, metadata?: Record<string, any>): this;
    addToGroup(groupId: string, entityId: string): this;
    removeFromGroup(groupId: string, entityId: string): boolean;
    getGroup(groupId: string): Entity[];
    listGroups(): EntityGroup[];
    deleteGroup(groupId: string): boolean;

    // Storage
    store(entity: Entity, options?: { activate?: boolean }): this;
    retrieve(entityId: string): Entity | null;
    getEntity(entityId: string): Entity | null;
    remove(entityId: string): boolean;

    // Activation
    activate(entityOrId: Entity | string): this;
    deactivate(entityId: string): this;
    isActive(entityId: string): boolean;

    // Ticking
    tick(entityId: string, deltaSeconds?: number | null): Entity | null;
    tickAll(deltaSeconds?: number | null): void;
    startAutoTick(rate?: number): void;
    stopAutoTick(): void;

    // Variables
    modifyVariable(entityId: string, varId: string, delta: number): boolean;
    setVariable(entityId: string, varId: string, value: number): boolean;
    getVariable(entityId: string, varId: string): number | null;
    checkThresholds(entity: Entity, varId: string): void;

    // Modifiers
    applyModifier(entityId: string, modifierId: string, config?: NodeConfig): boolean;
    removeModifier(entityId: string, modifierId: string): boolean;
    addModifier(entityId: string, modifierId: string): boolean;
    hasModifier(entityId: string, modifierId: string): boolean;

    // Traits
    activateTrait(entityId: string, traitId: string): boolean;
    deactivateTrait(entityId: string, traitId: string): boolean;
    hasTrait(entityId: string, traitId: string): boolean;

    // State
    getState(entityId: string): EntityState | null;
    snapshot(entityId: string): EntitySnapshot | null;
    getHistory(entityId: string): EntitySnapshot[];
    rollback(entityId: string, timestamp: number): boolean;
    query(filter: QueryFilter): Entity[];

    // Context
    setSpawnContext(context: Record<string, any>): this;
    getSpawnContext(): Record<string, any>;

    // Events
    on(event: EventType, callback: EventCallback): () => void;
    off(event: EventType, callback: EventCallback): void;
    emit(event: EventType, data: EventData): void;

    // Serialization
    export(): ExportedEntityManager;
    import(data: ExportedEntityManager): this;

    // Pooling (single pool - backward compatible)
    configurePool(config: PoolConfig): this;
    acquire(presetIdOrOverrides?: string | Partial<GenerateOverrides>, overrides?: Partial<GenerateOverrides>, targetPoolId?: string): Entity;
    release(entityOrId: Entity | string, targetPoolId?: string): boolean;
    preWarmPool(count: number, presetId?: string | null, poolId?: string): this;
    clearPool(poolId?: string): this;
    getPoolStats(poolId?: string): PoolStats;

    // Multi-pool management
    createPool(poolId: string, options?: PoolCreateOptions): PoolInstance;
    getPool(poolId: string): PoolInstance | null;
    listPools(): PoolSummary[];
    removePool(poolId: string): boolean;
    configurePool(poolId: string, config: PoolConfig): this;
    moveToPool(entityOrId: Entity | string, targetPoolId: string): boolean;
    setPoolRules(poolId: string, rules: PoolRules): this;
    getPoolForEntity(entity: Entity): string;
    getAllPoolStats(): Record<string, PoolStats>;
}

export interface EntityGroup {
    id: string;
    name: string;
    description: string;
    entities: Set<string>;
}

export interface ExportedEntityManager {
    stored: [string, Entity][];
    active: string[];
    history: [string, EntitySnapshot[]][];
    groups: [string, EntityGroup][];
    spawnContext: Record<string, any>;
}

// ============================================================================
// SPAWN ENGINE (Convenience Wrapper)
// ============================================================================

export declare class SpawnEngine {
    spawnManager: SpawnManager;
    entityManager: EntityManager;
    entities: Map<string, Entity>;

    constructor(config?: SpawnConfig | null);

    // Config
    loadConfig(config: SpawnConfig): this;
    readonly config: SpawnConfig | null;

    // Generation
    spawn(presetIdOrOverrides?: string | Partial<GenerateOverrides>, overrides?: Partial<GenerateOverrides>): Entity;
    generate(overrides?: Partial<GenerateOverrides>): Entity;
    spawnWhere(query: QueryFilter, overrides?: Partial<GenerateOverrides>): Entity;
    createSnapshot(overrides?: Partial<GenerateOverrides>): Entity;

    // Entity access
    getEntity(entityId: string): Entity | null;
    getAllEntities(): Entity[];
    despawn(entityId: string): boolean;
    register(entity: Entity): Entity;

    // Presets & groups
    registerPreset(id: string, template: PresetDefinition): this;
    registerPresets(presets: Record<string, PresetDefinition>): this;
    getPreset(id: string): PresetDefinition | null;
    listPresets(filter?: PresetFilter): PresetDefinition[];
    createGroup(groupId: string, metadata?: Record<string, any>): this;
    addToGroup(groupId: string, entityId: string): this;
    getGroup(groupId: string): Entity[];
    listGroups(): EntityGroup[];

    // Spawn context
    setSpawnContext(context: Record<string, any>): this;
    getSpawnContext(): Record<string, any>;

    // Runtime
    tick(entityOrId: Entity | string, deltaSeconds?: number | null): Entity | null;
    tickAll(deltaSeconds?: number | null): void;
    startAutoTick(): void;
    stopAutoTick(): void;

    // Variables
    modifyVariable(entity: Entity | string, varId: string, delta: number): boolean;
    setVariable(entity: Entity | string, varId: string, value: number): boolean;

    // Modifiers
    applyModifier(entity: Entity | string, modifierId: string): boolean;
    removeModifier(entity: Entity | string, modifierId: string): boolean;

    // Traits
    activateTrait(entity: Entity | string, traitId: string): boolean;
    deactivateTrait(entity: Entity | string, traitId: string): boolean;
    /** @deprecated Use activateTrait */
    activateItem(entity: Entity | string, itemId: string): boolean;
    /** @deprecated Use deactivateTrait */
    deactivateItem(entity: Entity | string, itemId: string): boolean;

    // State
    getState(entityId: string): EntityState | null;
    snapshot(entityId: string): EntitySnapshot | null;
    getHistory(entityId: string): EntitySnapshot[];
    rollback(entityId: string, timestamp: number): boolean;
    query(filter: QueryFilter): Entity[];

    // Node queries
    getNode(nodeId: string): NodeDefinition | null;
    getNodesByType(type: NodeType): NodeDefinition[];
    getAttributes(): NodeDefinition[];
    getVariables(): NodeDefinition[];
    getContexts(): NodeDefinition[];
    getLayers(): NodeDefinition[];
    getLayerTraits(layerId: string): NodeDefinition[];
    /** @deprecated Use getLayerTraits */
    getLayerItems(layerId: string): NodeDefinition[];
    getTraits(): NodeDefinition[];
    getModifiers(): NodeDefinition[];
    getCompounds(): NodeDefinition[];
    getDerived(): NodeDefinition[];

    // Relationship queries
    getRelationshipsFrom(nodeId: string): RelationshipDefinition[];
    getRelationshipsTo(nodeId: string): RelationshipDefinition[];
    getRelationshipsByType(type: RelationshipType): RelationshipDefinition[];

    // Analysis
    getWeights(entity: Entity, layerId: string): WeightedItem[];
    previewInfluences(nodeId: string): InfluencePreview;

    // Events
    on(event: EventType, callback: EventCallback): () => void;
    emit(event: EventType, data: EventData): void;

    // Serialization
    exportEntity(entityId: string): Entity | null;
    importEntity(data: Entity): string;
    export(): { config: SpawnConfig; entityManager: ExportedEntityManager };
    import(data: { config?: SpawnConfig; entityManager?: ExportedEntityManager }): this;

    // Pooling (delegated to EntityManager)
    configurePool(config: PoolConfig): this;
    configurePool(poolId: string, config: PoolConfig): this;
    acquire(presetIdOrOverrides?: string | Partial<GenerateOverrides>, overrides?: Partial<GenerateOverrides>, targetPoolId?: string): Entity;
    release(entityOrId: Entity | string, targetPoolId?: string): boolean;
    preWarmPool(count: number, presetId?: string | null, poolId?: string): this;
    getPoolStats(poolId?: string): PoolStats;
    clearPool(poolId?: string): this;

    // Multi-pool management
    createPool(poolId: string, options?: PoolCreateOptions): PoolInstance;
    getPool(poolId: string): PoolInstance | null;
    listPools(): PoolSummary[];
    removePool(poolId: string): boolean;
    moveToPool(entityOrId: Entity | string, targetPoolId: string): boolean;
    setPoolRules(poolId: string, rules: PoolRules): this;
    getPoolForEntity(entity: Entity): string;
    getAllPoolStats(): Record<string, PoolStats>;
}

// ============================================================================
// CSV IMPORTER
// ============================================================================

export declare class CSVImporter {
    static parse(csvString: string, options?: { delimiter?: string }): Record<string, any>[];
    static parseLine(line: string, delimiter: string): string[];
    static importAttributes(csvString: string, config: SpawnConfig): NodeDefinition[];
    static importVariables(csvString: string, config: SpawnConfig): NodeDefinition[];
    static importTraits(csvString: string, config: SpawnConfig): NodeDefinition[];
    static importRelationships(csvString: string, config: SpawnConfig): RelationshipDefinition[];
}

// ============================================================================
// GLOBAL EXPORTS
// ============================================================================

declare global {
    interface Window {
        SpawnManager: typeof SpawnManager;
        EntityManager: typeof EntityManager;
        SpawnEngine: typeof SpawnEngine;
        CSVImporter: typeof CSVImporter;
    }
}

export { SpawnManager, EntityManager, SpawnEngine, CSVImporter };
