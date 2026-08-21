export function renderAssetPackDiagnostics(assetPack) {
  const diagnostics = [];
  if (assetPack.disclaimerRequired) {
    diagnostics.push({
      code: 'asset.disclaimer_required',
      status: 'informational',
      evidenceTier: 'render_asset_policy',
      sourceKind: 'asset_pack_selector',
      packId: assetPack.packId,
      packKind: assetPack.packKind,
      conservativeFallback: 'show_required_disclaimer',
      message: 'Selected visual pack requires the unofficial fan-project disclaimer.',
    });
  }
  if (!assetPack.available) {
    diagnostics.push({
      code: 'asset.pack_unavailable',
      status: 'render_warning',
      evidenceTier: 'render_asset_policy',
      sourceKind: 'asset_pack_selector',
      packId: assetPack.packId,
      packKind: assetPack.packKind,
      fallbackPackId: assetPack.fallbackPackId,
      conservativeFallback: 'open_placeholder',
      message: 'Selected visual pack is unavailable; stable IDs render with placeholders.',
    });
  }
  return diagnostics;
}

export default function DebugPanel({
  open,
  compileResult,
  runtimeResult,
  assetPack,
  assetPackDiagnostics,
  selectedDebugId,
  selectDebugItem,
}) {
  const runtimeIntents = runtimeResult?.intents ?? [];
  const diagnostics = compileResult?.diagnostics ?? [];
  const graph = compileResult?.graph ?? { nodes: [], edges: [] };
  const graphNodes = graph.nodes ?? [];
  const graphEdges = graph.edges ?? [];
  const sourceStatus = runtimeResult?.sourceStatus ?? [];
  const sourceBindings = runtimeIntents.filter(
    (intent) => intent.intentType === 'source_binding',
  );
  const intentGroups = countBy(runtimeIntents, (intent) => intent.intentType ?? 'unknown');
  const evidenceRecords = [
    ...diagnostics,
    ...graphNodes,
    ...runtimeIntents,
    ...assetPackDiagnostics,
  ];
  const evidenceGroups = countBy(
    evidenceRecords,
    (diagnostic) =>
      diagnostic.evidenceTier ??
      diagnostic.evidence ??
      diagnostic.evidenceLevel ??
      'unspecified',
  );
  const debugItems = buildDebugItems({
    runtimeIntents,
    diagnostics,
    graphNodes,
    graphEdges,
    sourceStatus,
    sourceBindings,
  });
  const selectedDebugItem =
    debugItems.find((item) => item.id === selectedDebugId) ?? null;

  if (!open) {
    return (
      <section className="debug-panel collapsed" aria-label="Debug panel">
        <p>Debug panel collapsed. Warnings and evidence details are hidden from the main scene.</p>
      </section>
    );
  }

  return (
    <section className="debug-panel" aria-label="Debug panel">
      <div className="debug-summary" data-testid="debug-summary">
        <DebugMetric label="Runtime intents" value={runtimeIntents.length} />
        <DebugMetric label="Graph nodes" value={graphNodes.length} testId="debug-graph-node-count" />
        <DebugMetric label="Graph edges" value={graphEdges.length} testId="debug-graph-edge-count" />
        <DebugMetric label="Diagnostics" value={diagnostics.length} />
        <DebugMetric label="Render warnings" value={assetPackDiagnostics.length} testId="debug-asset-diagnostic-count" />
        <DebugMetric label="Sources" value={sourceStatus.length} />
        <DebugMetric label="Bindings" value={sourceBindings.length} testId="debug-binding-count" />
      </div>

      <section className="debug-section" aria-labelledby="debug-runtime-heading">
        <h2 id="debug-runtime-heading">Runtime Intents</h2>
        <DebugCountTable
          rows={intentGroups}
          labelHeader="Intent type"
          emptyLabel="No runtime intents"
          testId="debug-intent-groups"
        />
        <details>
          <summary>Raw intents JSON</summary>
          <pre data-testid="runtime-intents">{JSON.stringify(runtimeIntents, null, 2)}</pre>
        </details>
      </section>

      <section className="debug-section" aria-labelledby="debug-items-heading">
        <h2 id="debug-items-heading">Debug Items</h2>
        <DebugItemTable
          items={debugItems}
          selectedDebugId={selectedDebugId}
          selectDebugItem={selectDebugItem}
        />
      </section>

      <section className="debug-section" aria-labelledby="debug-selected-heading">
        <h2 id="debug-selected-heading">Selected Item</h2>
        {selectedDebugItem ? (
          <>
            <dl className="debug-kv" data-testid="debug-selected-summary">
              <div>
                <dt>Kind</dt>
                <dd>{selectedDebugItem.kind}</dd>
              </div>
              <div>
                <dt>Label</dt>
                <dd>{selectedDebugItem.label}</dd>
              </div>
            </dl>
            <pre data-testid="debug-selected-json">
              {JSON.stringify(selectedDebugItem.record, null, 2)}
            </pre>
          </>
        ) : (
          <p className="debug-empty" data-testid="debug-selected-empty">
            Select a debug item to inspect it.
          </p>
        )}
      </section>

      <section className="debug-section" aria-labelledby="debug-sources-heading">
        <h2 id="debug-sources-heading">Source Availability</h2>
        <SourceStatusTable sources={sourceStatus} />
        <h3>Bindings</h3>
        <SourceBindingsTable bindings={sourceBindings} />
      </section>

      <section className="debug-section" aria-labelledby="debug-diagnostics-heading">
        <h2 id="debug-diagnostics-heading">Diagnostics and Evidence</h2>
        <DebugCountTable
          rows={evidenceGroups}
          labelHeader="Evidence tier"
          emptyLabel="No diagnostics"
          testId="debug-evidence-groups"
        />
        <details>
          <summary>Raw diagnostics JSON</summary>
          <pre data-testid="debug-diagnostics-json">{JSON.stringify(diagnostics, null, 2)}</pre>
        </details>
      </section>

      <section className="debug-section" aria-labelledby="debug-assets-heading">
        <h2 id="debug-assets-heading">Render Assets</h2>
        <dl className="debug-kv" data-testid="debug-asset-pack">
          <div>
            <dt>Pack</dt>
            <dd>{assetPack.packDisplayName}</dd>
          </div>
          <div>
            <dt>Kind</dt>
            <dd>{assetPack.packKind}</dd>
          </div>
          <div>
            <dt>Fallback</dt>
            <dd>{assetPack.fallbackPackId ?? 'none'}</dd>
          </div>
        </dl>
        {assetPackDiagnostics.length > 0 ? (
          <table className="debug-table" data-testid="debug-asset-diagnostics">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Status</th>
                <th scope="col">Fallback</th>
              </tr>
            </thead>
            <tbody>
              {assetPackDiagnostics.map((diagnostic) => (
                <tr key={diagnostic.code}>
                  <td>{diagnostic.code}</td>
                  <td>{diagnostic.status}</td>
                  <td>{diagnostic.conservativeFallback}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="debug-empty" data-testid="debug-asset-diagnostics">
            No render asset diagnostics
          </p>
        )}
      </section>

      <section className="debug-section" aria-labelledby="debug-graph-heading">
        <h2 id="debug-graph-heading">Graph</h2>
        <dl className="debug-kv">
          <div>
            <dt>Nodes</dt>
            <dd>{graphNodes.length}</dd>
          </div>
          <div>
            <dt>Edges</dt>
            <dd>{graphEdges.length}</dd>
          </div>
        </dl>
        <details>
          <summary>Raw graph JSON</summary>
          <pre data-testid="debug-graph-json">{JSON.stringify(graph, null, 2)}</pre>
        </details>
      </section>
    </section>
  );
}

function DebugMetric({ label, value, testId }) {
  return (
    <div className="debug-metric">
      <span>{label}</span>
      <strong data-testid={testId}>{value}</strong>
    </div>
  );
}

function DebugCountTable({ rows, labelHeader, emptyLabel, testId }) {
  if (rows.length === 0) {
    return (
      <p className="debug-empty" data-testid={testId}>
        {emptyLabel}
      </p>
    );
  }
  return (
    <table className="debug-table" data-testid={testId}>
      <thead>
        <tr>
          <th scope="col">{labelHeader}</th>
          <th scope="col">Count</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td>{row.label}</td>
            <td>{row.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DebugItemTable({ items, selectedDebugId, selectDebugItem }) {
  if (items.length === 0) {
    return (
      <p className="debug-empty" data-testid="debug-item-list">
        No debug items
      </p>
    );
  }
  return (
    <table className="debug-table" data-testid="debug-item-list">
      <thead>
        <tr>
          <th scope="col">Kind</th>
          <th scope="col">Label</th>
          <th scope="col">Status</th>
          <th scope="col">Action</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className={item.id === selectedDebugId ? 'debug-row-selected' : ''}>
            <td>{item.kind}</td>
            <td>{item.label}</td>
            <td>{item.status}</td>
            <td>
              <button
                type="button"
                className="debug-inspect-button"
                aria-pressed={item.id === selectedDebugId}
                onClick={() => selectDebugItem(item.id)}
              >
                Inspect
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SourceStatusTable({ sources }) {
  if (sources.length === 0) {
    return (
      <p className="debug-empty" data-testid="debug-source-status">
        No scene sources
      </p>
    );
  }
  return (
    <table className="debug-table" data-testid="debug-source-status">
      <thead>
        <tr>
          <th scope="col">Source</th>
          <th scope="col">Family</th>
          <th scope="col">Amount</th>
          <th scope="col">State</th>
        </tr>
      </thead>
      <tbody>
        {sources.map((source) => (
          <tr key={source.id}>
            <td>{source.label ?? source.id}</td>
            <td>{source.materialFamily ?? source.kind}</td>
            <td>
              {source.nonDepleting ? 'non-depleting' : `${roundForDebug(source.amount)}/${roundForDebug(source.capacity)}`}
            </td>
            <td>{source.available ? 'available' : 'empty'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SourceBindingsTable({ bindings }) {
  if (bindings.length === 0) {
    return (
      <p className="debug-empty" data-testid="debug-source-bindings">
        No source bindings
      </p>
    );
  }
  return (
    <table className="debug-table" data-testid="debug-source-bindings">
      <thead>
        <tr>
          <th scope="col">Mode</th>
          <th scope="col">Source</th>
          <th scope="col">Material</th>
          <th scope="col">Acquired</th>
        </tr>
      </thead>
      <tbody>
        {bindings.map((binding) => (
          <tr key={binding.id}>
            <td>{binding.sourceMode}</td>
            <td>{binding.sourceId}</td>
            <td>{binding.materialKind}</td>
            <td>{roundForDebug(binding.acquiredAmount ?? binding.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function buildDebugItems({
  runtimeIntents,
  diagnostics,
  graphNodes,
  graphEdges,
  sourceStatus,
  sourceBindings,
}) {
  return [
    ...runtimeIntents.map((intent) => ({
      id: `runtime:${intent.id ?? intent.nodeId ?? intent.intentType}`,
      kind: 'runtime',
      label: intent.intentType ?? 'runtime intent',
      status: debugStatus(intent),
      record: intent,
    })),
    ...sourceStatus.map((source) => ({
      id: `source:${source.id}`,
      kind: 'source',
      label: source.label ?? source.id,
      status: source.available ? 'available' : 'empty',
      record: source,
    })),
    ...sourceBindings.map((binding) => ({
      id: `binding:${binding.id}`,
      kind: 'binding',
      label: binding.sourceMode ?? binding.materialKind ?? binding.id,
      status: binding.active ? 'active' : 'inactive',
      record: binding,
    })),
    ...diagnostics.map((diagnostic, index) => ({
      id: `diagnostic:${diagnostic.id ?? diagnostic.code ?? index}`,
      kind: 'diagnostic',
      label: diagnostic.code ?? diagnostic.id ?? `diagnostic ${index + 1}`,
      status: diagnostic.status ?? diagnostic.severity ?? 'reported',
      record: diagnostic,
    })),
    ...graphNodes.map((node) => ({
      id: `graph-node:${node.nodeId}`,
      kind: 'graph node',
      label: node.nodeType ?? node.registryId ?? node.nodeId,
      status: node.status ?? node.evidenceTier ?? 'compiled',
      record: node,
    })),
    ...graphEdges.map((edge, index) => ({
      id: `graph-edge:${edge.edgeId ?? index}`,
      kind: 'graph edge',
      label: edge.edgeType ?? edge.edgeId ?? `edge ${index + 1}`,
      status: edge.status ?? 'compiled',
      record: edge,
    })),
  ];
}

function debugStatus(record) {
  if (record.active === true) return 'active';
  if (record.active === false) return 'inactive';
  if (record.satisfied === true) return 'satisfied';
  if (record.satisfied === false) return 'unsatisfied';
  return record.status ?? record.evidenceTier ?? 'available';
}

function countBy(items, getLabel) {
  const counts = new Map();
  for (const item of items) {
    const label = String(getLabel(item));
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function roundForDebug(value) {
  return Math.round(Number(value ?? 0) * 100) / 100;
}
