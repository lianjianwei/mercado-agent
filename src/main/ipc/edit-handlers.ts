import { randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';

import { IPC_CHANNELS, type IpcRegistrar } from '../../shared/ipc-contract';
import type { ProductSnapshotRepository } from '../../domain/product';
import { DIMENSION_UNIT, WEIGHT_UNIT, type EditDraft } from '../../domain/edit';
import { editDraftSchema } from '../../shared/edit-output-schema';
import type { EditGenerationService } from '../services/edit-generation-service';

const productIdSchema = z.strictObject({ productId: z.string().min(1) });

const saveDraftSchema = z.strictObject({
  productId: z.string().min(1),
  draft: editDraftSchema,
});

type EditHandlerDependencies = {
  snapshots: Pick<ProductSnapshotRepository, 'listForProduct' | 'append'>;
  service: Pick<EditGenerationService, 'generate'>;
};

// The aiDraft snapshot is the second of the product's two snapshots: it
// mirrors what the AI edit produced and diverges from the miaoshou snapshot
// until the draft is saved back to Miaoshou (a later sub-phase). Reading the
// latest aiDraft for a product is how the renderer shows the AI edit detail.
export function readLatestDraft(
  snapshots: Pick<ProductSnapshotRepository, 'listForProduct'>,
  productId: string,
): EditDraft | null {
  const drafts = snapshots
    .listForProduct(productId)
    .filter((snapshot) => snapshot.kind === 'aiDraft');
  const latest = drafts[drafts.length - 1];
  return latest ? normalizeDraft(latest.payload as EditDraft) : null;
}

// Drafts saved before the units became fixed constants (cm/g) stored
// dimensionUnit/weightUnit as { value, source, confidence } objects. Coerce
// them to the current string-literal shape so the renderer never receives an
// object where it expects a string (which would crash React with "Objects are
// not valid as a React child").
//
// Drafts saved before the multi-SKU model kept a single top-level package;
// those are migrated by dropping the legacy top-level package and normalizing
// each SKU package's units.
function normalizeDraft(draft: EditDraft): EditDraft {
  const legacy = draft as EditDraft & { package?: unknown };
  const emptyField = { value: '', source: 'ai', confidence: 0 } as const;
  const normalizePackage = (
    pkg?: Partial<EditDraft['skus'][number]['package']>,
  ): EditDraft['skus'][number]['package'] => ({
    length: pkg?.length ?? emptyField,
    width: pkg?.width ?? emptyField,
    height: pkg?.height ?? emptyField,
    dimensionUnit: DIMENSION_UNIT,
    weight: pkg?.weight ?? emptyField,
    weightUnit: WEIGHT_UNIT,
  });
  return {
    ...draft,
    skus: (legacy.skus ?? []).map((sku) => ({
      ...sku,
      // Old drafts stored only skuKey + name (no per-SKU stock/sourcePrice/
      // package); default the missing fields so the panel renders without
      // crashing on sku.stock.value / sku.package.length.value.
      stock: sku.stock ?? emptyField,
      sourcePrice: sku.sourcePrice ?? emptyField,
      package: normalizePackage(sku.package),
    })),
  };
}

export function registerEditHandlers(
  registrar: IpcRegistrar,
  dependencies: EditHandlerDependencies,
): void {
  registrar.handle(IPC_CHANNELS.editGenerate, async (_event, payload) => {
    try {
      const { productId } = productIdSchema.parse(payload);
      const draft = await dependencies.service.generate(productId);
      appendDraft(dependencies.snapshots, productId, draft);
      return { ok: true, data: draft };
    } catch (error) {
      if (error instanceof ZodError) {
        return {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR' as const,
            message: '商品 ID 无效',
          },
        };
      }
      return {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR' as const,
          message: error instanceof Error ? error.message : 'AI 编辑草稿生成失败',
        },
      };
    }
  });

  registrar.handle(IPC_CHANNELS.editDraft, async (_event, payload) => {
    try {
      const { productId } = productIdSchema.parse(payload);
      return { ok: true, data: readLatestDraft(dependencies.snapshots, productId) };
    } catch (error) {
      if (error instanceof ZodError) {
        return {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR' as const,
            message: '商品 ID 无效',
          },
        };
      }
      return {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR' as const,
          message: '编辑草稿读取失败',
        },
      };
    }
  });

  registrar.handle(IPC_CHANNELS.editSaveDraft, async (_event, payload) => {
    try {
      const { productId, draft } = saveDraftSchema.parse(payload);
      const saved = {
        ...draft,
        version: nextVersion(dependencies.snapshots, productId, draft),
      };
      appendDraft(dependencies.snapshots, productId, saved);
      return { ok: true, data: saved };
    } catch (error) {
      if (error instanceof ZodError) {
        return {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR' as const,
            message: '编辑草稿内容无效',
          },
        };
      }
      return {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR' as const,
          message: error instanceof Error ? error.message : '编辑草稿保存失败',
        },
      };
    }
  });
}

function appendDraft(
  snapshots: Pick<ProductSnapshotRepository, 'append'>,
  productId: string,
  draft: EditDraft,
): void {
  snapshots.append({
    id: `${productId}:aiDraft:${randomUUID()}`,
    productId,
    kind: 'aiDraft',
    capturedAt: draft.createdAt,
    payload: draft,
  });
}

function nextVersion(
  snapshots: Pick<ProductSnapshotRepository, 'listForProduct'>,
  productId: string,
  incoming: EditDraft,
): number {
  const current = readLatestDraft(snapshots, productId);
  if (!current) return incoming.version;
  return Math.max(current.version + 1, incoming.version);
}
