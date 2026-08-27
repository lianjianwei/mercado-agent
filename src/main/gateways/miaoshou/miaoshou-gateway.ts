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
}
