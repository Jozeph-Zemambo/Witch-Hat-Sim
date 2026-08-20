import { compileSpell } from '../../../src/compiler/compile.js';
import {
  buildSpellDocument,
  validateSpellMakerDraft,
} from '../../../src/spell-maker/authoring.js';

export function createAuthoredSpellTemplate(draft, id) {
  return prepareAuthoredSpellTemplate(draft, id);
}

export function updateAuthoredSpellTemplate(existingTemplate, draft) {
  if (!existingTemplate?.authorDraft) {
    return {
      ok: false,
      error: 'Structured editing is unavailable for imported spells.',
    };
  }
  return prepareAuthoredSpellTemplate(draft, existingTemplate.id);
}

function prepareAuthoredSpellTemplate(draft, id) {
  const validation = validateSpellMakerDraft(draft);
  if (!validation.valid) return { ok: false, validation };
  try {
    const document = buildSpellDocument(draft);
    const compileResult = compileSpell(document);
    const template = {
      id,
      programId: compileResult.program?.programId ?? id,
      name: draft.name.trim(),
      source: 'spell_maker',
      sourceLabel: 'Created spell',
      authoredDocument: cloneJson(document),
      authorDraft: cloneJson(draft),
      compileResult: cloneJson(compileResult),
    };
    return {
      ok: true,
      template,
      document: cloneJson(document),
      compileResult: cloneJson(compileResult),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not compile this spell.',
    };
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
