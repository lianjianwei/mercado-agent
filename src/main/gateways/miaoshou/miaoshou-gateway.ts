import type {
  CollectBoxDetailDto,
  CollectBoxPageDto,
  ListCollectBoxInput,
} from '../../../shared/miaoshou-schemas';

export interface MiaoshouGateway {
  listCollectBox(
    input: ListCollectBoxInput,
    signal?: AbortSignal,
  ): Promise<CollectBoxPageDto>;
  getCollectBoxDetail(
    detailId: string,
    signal?: AbortSignal,
  ): Promise<CollectBoxDetailDto>;
  // 把采集箱站点详情(整包 siteCollectItemInfo)保存到妙手。detailId 即采集箱详情ID
  // (数字串)。成功以不抛错表示;业务/鉴权/限流错误仍映射为相应类型。
  saveCollectBoxItemInfo(
    detailId: string,
    info: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<void>;
}
