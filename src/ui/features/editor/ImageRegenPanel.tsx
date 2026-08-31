import { useState } from 'react';
import type { AiImagesResult, GeneratedImage, ImageRegenerateTarget } from '../../../domain/images';

type ImageRegenPanelProps = {
  productId: string;
  imageResult: AiImagesResult | null;
  regenerating: boolean;
  uploading: boolean;
  onRegenerate: (targets: ImageRegenerateTarget[]) => Promise<void>;
  onUpload: () => Promise<void>;
};

type Card = {
  image: GeneratedImage;
  kind: 'main' | 'detail';
  index: number;
  label: string;
  src: string;
  statusLabel: string;
};

type Selection = Record<string, { checked: boolean; hint: string }>;

const STATUS_LABEL: Record<GeneratedImage['status'], string> = {
  ok: '正常',
  retried: '补跑',
  failed: '失败',
};

// 本地未上传的图没有公网 URL,转成 app-image:// 自定义协议 URL 供渲染层展示。
function toAppImageUrl(localPath: string, productId: string): string {
  const fileName = localPath.split(/[\\/]/).pop() ?? '';
  return fileName ? `app-image://${productId}/${fileName}` : '';
}

// 缩略图:优先公网 URL,加载失败自动退回本地 app-image 图,再失败才显示「无法预览」,
// 避免出现浏览器破图标(尤其本地协议/七牛偶发失败时)。
// 卡片由外层按 imageId + snapshot key 重挂载,src 在挂载期不变,故用惰性初始值即可。
function PreviewImage({ src, localPath, productId, alt }: { src: string; localPath: string; productId: string; alt: string }) {
  const [current, setCurrent] = useState(src);
  const [failed, setFailed] = useState(false);

  if (failed) return <span className="image-regen-thumb-none">无法预览</span>;
  return (
    <img
      alt={alt}
      onError={() => {
        const fallback = localPath ? toAppImageUrl(localPath, productId) : '';
        if (current !== fallback && fallback) setCurrent(fallback);
        else setFailed(true);
      }}
      src={current}
    />
  );
}

function makeCards(result: AiImagesResult | null, productId: string): Card[] {
  if (!result) return [];
  const cards: Card[] = [];
  result.mainImages.forEach((image, index) => {
    cards.push({
      image,
      kind: 'main',
      index: index + 1,
      label: `主图 ${index + 1}`,
      src: image.publicUrl ?? toAppImageUrl(image.localPath, productId),
      statusLabel: STATUS_LABEL[image.status],
    });
  });
  result.detailImages.forEach((image, index) => {
    cards.push({
      image,
      kind: 'detail',
      index: index + 1,
      label: image.detail?.title ? `详情图 ${index + 1} · ${image.detail.title}` : `详情图 ${index + 1}`,
      src: image.publicUrl ?? toAppImageUrl(image.localPath, productId),
      statusLabel: STATUS_LABEL[image.status],
    });
  });
  return cards;
}

export function ImageRegenPanel(props: ImageRegenPanelProps) {
  const { imageResult, productId } = props;
  const cards = makeCards(imageResult, productId);

  if (!imageResult || cards.length === 0) {
    return (
      <section className="image-regen-panel" aria-label="生图结果">
        <div className="image-regen-panel-head">
          <h3>生图结果</h3>
        </div>
        <p className="image-regen-empty">暂未生成图片。请先点「生成 AI 草稿」并勾选图片生成，或先重新生成一次图片。</p>
      </section>
    );
  }

  // 以快照时间作 key:每次生成/重生成/上传都会落新快照,key 变 → 内层重置勾选与提示词。
  return <ImageRegenGrid key={imageResult.createdAt} {...props} />;
}

function ImageRegenGrid({ imageResult, productId, regenerating, uploading, onRegenerate, onUpload }: ImageRegenPanelProps) {
  // 懒初始化:仅本次快照的勾选/提示词;快照变化由外层 key 触发重挂载来重置。
  const [selection, setSelection] = useState<Selection>(() => {
    const next: Selection = {};
    for (const card of makeCards(imageResult, productId)) {
      next[card.image.imageId] = { checked: false, hint: '' };
    }
    return next;
  });

  const cards = makeCards(imageResult, productId);
  const selectedCount = cards.filter((card) => selection[card.image.imageId]?.checked).length;

  const setChecked = (imageId: string, checked: boolean) => {
    setSelection((current) => ({ ...current, [imageId]: { ...(current[imageId] ?? { hint: '' }), checked } }));
  };
  const setHint = (imageId: string, hint: string) => {
    setSelection((current) => ({ ...current, [imageId]: { ...(current[imageId] ?? { checked: false }), hint } }));
  };
  const allSelected = cards.length > 0 && selectedCount === cards.length;
  const setAll = (checked: boolean) => {
    setSelection((current) => {
      const next: Selection = {};
      for (const card of cards) next[card.image.imageId] = { ...(current[card.image.imageId] ?? { hint: '' }), checked };
      return next;
    });
  };

  const runRegenerate = () => {
    const targets: ImageRegenerateTarget[] = cards
      .filter((card) => selection[card.image.imageId]?.checked)
      .map((card) => {
        const hint = selection[card.image.imageId]?.hint?.trim();
        return { imageId: card.image.imageId, ...(hint ? { hint } : {}) };
      });
    if (targets.length === 0) return;
    void onRegenerate(targets);
  };

  return (
    <section className="image-regen-panel" aria-label="生图结果">
      <div className="image-regen-panel-head">
        <h3>生图结果</h3>
        <label className="image-regen-select-all">
          <input checked={allSelected} onChange={(event) => setAll(event.target.checked)} type="checkbox" />
          <span>全选本批</span>
        </label>
      </div>
      <p className="image-regen-note">
        勾选不满意的图，每张可单独填一句改进方向。重生成只会重跑选中的这几张（只出本地预览），其余不动；满意后再点「上传并应用」统一上传并写回草稿。
      </p>
      <div className="image-regen-grid">
        {cards.map((card) => {
          const sel = selection[card.image.imageId] ?? { checked: false, hint: '' };
          return (
            <div className={`image-regen-card${sel.checked ? ' selected' : ''}`} key={card.image.imageId}>
              <label className="image-regen-card-top">
                <input
                  checked={sel.checked}
                  onChange={(event) => setChecked(card.image.imageId, event.target.checked)}
                  type="checkbox"
                />
                <span className="image-regen-card-label">{card.label}</span>
                <span className={`image-regen-status ${card.image.status}`}>{card.statusLabel}</span>
              </label>
              <div className="image-regen-card-thumb">
                {card.src
                  ? <PreviewImage alt={card.label} src={card.src} localPath={card.image.localPath} productId={productId} />
                  : <span className="image-regen-thumb-none">无图</span>}
              </div>
              <textarea
                className="image-regen-hint"
                disabled={!sel.checked}
                onChange={(event) => setHint(card.image.imageId, event.target.value)}
                placeholder={sel.checked ? '改进方向(如:把每面槽位改回4个,保持外壳不变)…' : '勾选后可填写改进方向'}
                value={sel.hint}
              />
            </div>
          );
        })}
      </div>
      <div className="image-regen-actions">
        <button
          className="primary-button"
          disabled={selectedCount === 0 || regenerating}
          onClick={runRegenerate}
          type="button"
        >
          {regenerating ? '重生成中…' : `重新生成选中(${selectedCount})`}
        </button>
        <button
          className="secondary-button"
          disabled={uploading || cards.length === 0}
          onClick={() => void onUpload()}
          type="button"
        >
          {uploading ? '上传中…' : '上传并应用'}
        </button>
      </div>
    </section>
  );
}
