import { z } from 'zod';

export const miaoshouCollectBoxStatusSchema = z.enum([
  'notPublished',
  'timingPublish',
  'published',
]);

export const listCollectBoxInputSchema = z.strictObject({
  pageNo: z.number().int().min(1),
  pageSize: z.number().int().min(20).max(500),
  filter: z
    .strictObject({
      status: miaoshouCollectBoxStatusSchema.optional(),
      filterCidSite: z.literal('CBT').optional(),
      sourceItemIdKeyword: z.string().max(255).optional(),
    })
    .optional(),
});

const identifierSchema = z.union([z.string(), z.number()]).transform(String);
const collectBoxDetailIdSchema = z
  .union([
    z.number().int().positive().safe(),
    z
      .string()
      .regex(/^[1-9]\d*$/)
      .refine((value) => Number.isSafeInteger(Number(value))),
  ])
  .transform(String);
const numericValueSchema = z.union([z.number(), z.string()]);
const nullableOptionalStringSchema = z
  .string()
  .nullable()
  .transform((value) => value ?? undefined)
  .optional();
const nullableOptionalIdentifierSchema = identifierSchema
  .nullable()
  .transform((value) => value ?? undefined)
  .optional();

const collectBoxShopSchema = z.looseObject({
  shopId: identifierSchema.optional(),
  pricingMode: z.string().optional(),
  siteAndMaxPriceMap: z.record(z.string(), numericValueSchema).optional(),
  siteAndMinPriceMap: z.record(z.string(), numericValueSchema).optional(),
  siteAndPriceMap: z.record(z.string(), numericValueSchema).optional(),
  sites: z.array(z.string()).optional(),
});

const collectBoxListItemSchema = z.looseObject({
  collectBoxDetailId: collectBoxDetailIdSchema,
  itemNum: nullableOptionalStringSchema,
  breadcrumb: nullableOptionalStringSchema,
  cid: nullableOptionalIdentifierSchema,
  globalPrice: numericValueSchema.optional(),
  stock: numericValueSchema.optional(),
  price: numericValueSchema.optional(),
  thumbnail: z.string().optional(),
  gmtCreate: z.string().optional(),
  editModel: nullableOptionalStringSchema,
  commonCollectBoxDetailId: identifierSchema.optional(),
  appAccountId: identifierSchema.optional(),
  subAppAccountId: nullableOptionalIdentifierSchema,
  platform: z.string().optional(),
  title: z.string().optional(),
  remark: nullableOptionalStringSchema,
  copyType: z.string().optional(),
  collectBoxGroupId: identifierSchema.optional(),
  collectBoxDetailShop: collectBoxShopSchema.optional(),
});

const listResponseDataSchema = z
  .looseObject({
    detailList: z.array(collectBoxListItemSchema).optional(),
    list: z.array(collectBoxListItemSchema).optional(),
    total: z.union([z.number(), z.string()]).optional(),
  })
  .superRefine((value, context) => {
    if (!value.detailList && !value.list) {
      context.addIssue({
        code: 'custom',
        path: ['detailList'],
        message: 'Miaoshou list response is missing detailList/list',
      });
    }
  });

export const collectBoxListResponseSchema = z.looseObject({
  result: z.literal('success'),
  code: z.literal('success'),
  message: z.string().optional(),
  data: listResponseDataSchema,
});

const attributeValueSchema = z.looseObject({
  id: identifierSchema.optional(),
  displayName: z.string().optional(),
  name: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

const attributeRuleSchema = z.looseObject({
  attributeGroupId: identifierSchema.optional(),
  attributeGroupName: z.string().optional(),
  displayName: z.string().optional(),
  hierarchy: z.string().optional(),
  id: identifierSchema.optional(),
  name: z.string().optional(),
  relevance: z.number().int().optional(),
  tags: z.record(z.string(), z.unknown()).optional(),
  valueType: z.string().optional(),
  values: z.array(attributeValueSchema).nullable().optional(),
});

const productAttributeSchema = z.looseObject({
  name: z.string().optional(),
  valueType: z.string().optional(),
  values: z.array(attributeValueSchema).optional(),
});

const saleAttributeSchema = z.looseObject({
  name: z.string().optional(),
  values: z.array(
    z.looseObject({
      skuKey: identifierSchema.optional(),
      name: z.string().optional(),
    }),
  ),
});

const siteCollectItemInfoSchema = z
  .looseObject({
    collectBoxDetailId: collectBoxDetailIdSchema.optional(),
    detailId: collectBoxDetailIdSchema.optional(),
    title: z.string().optional(),
    itemNum: z.string().nullable().optional(),
    attributes: z.array(productAttributeSchema).optional(),
    cateList: z.array(z.unknown()).optional(),
    firstSkuKey: z.string().nullable().optional(),
    originPrice: numericValueSchema.optional(),
    price: numericValueSchema.optional(),
    cid: identifierSchema.optional(),
    notes: z.string().optional(),
    notesFull: z.string().optional(),
    warrantyType: z.string().optional(),
    warrantyTime: z.string().nullable().optional(),
    warrantyTimeUnit: z.string().optional(),
    sourceImgUrls: z.array(z.string()).optional(),
    sourceItemUrl: z.string().optional(),
    source: z.string().optional(),
    sourceItemId: identifierSchema.optional(),
    siteAndListingTypeList: z.array(
      z.looseObject({
        site: z.string(),
        listingType: z.string().optional(),
      }),
    ).optional(),
    siteAndTitleList: z.array(
      z.looseObject({ site: z.string(), title: z.string().optional() }),
    ).optional(),
    pricingMode: z.string().optional(),
    shopId: identifierSchema.optional(),
    saleAttributes: z.array(saleAttributeSchema).optional(),
    sites: z.array(z.string()).optional(),
    siteAndPriceMap: z.record(z.string(), numericValueSchema).optional(),
    skuMap: z.record(z.string(), z.looseObject({})).optional(),
    hasSaveSite: z.number().int().nullable().optional(),
    saveDetailTs: z.number().int().nullable().optional(),
    hasSavePrice: z.number().int().nullable().optional(),
    site: z.string().nullable().optional(),
    registrationType: z.string().nullable().optional(),
  })
  .superRefine((value, context) => {
    if (!value.collectBoxDetailId && !value.detailId) {
      context.addIssue({
        code: 'custom',
        path: ['collectBoxDetailId'],
        message: 'Miaoshou detail response is missing its detail identifier',
      });
    }
  })
  .transform((value) => ({
    ...value,
    collectBoxDetailId: value.collectBoxDetailId ?? value.detailId!,
  }));

export const collectBoxDetailResponseSchema = z.looseObject({
  result: z.literal('success'),
  code: z.literal('success'),
  message: z.string().optional(),
  data: z.looseObject({
    saleAttributeRules: z.array(attributeRuleSchema).optional(),
    productAttributeRules: z.array(attributeRuleSchema).optional(),
    skuAttributeRules: z.array(attributeRuleSchema).optional(),
    siteCollectItemInfo: siteCollectItemInfoSchema,
  }),
});

export type ListCollectBoxInput = z.infer<typeof listCollectBoxInputSchema>;
export type CollectBoxListItemDto = z.infer<typeof collectBoxListItemSchema> & {
  sites: string[];
};
export type CollectBoxPageDto = {
  pageNo: number;
  pageSize: number;
  total: number | null;
  hasMore: boolean;
  items: CollectBoxListItemDto[];
};
export type CollectBoxDetailDto = z.infer<
  typeof collectBoxDetailResponseSchema
>['data'];

export function parseCollectBoxPage(
  response: unknown,
  input: ListCollectBoxInput,
): CollectBoxPageDto {
  const request = listCollectBoxInputSchema.parse(input);
  const parsed = collectBoxListResponseSchema.parse(response);
  const items = parsed.data.detailList ?? parsed.data.list ?? [];
  const totalValue = parsed.data.total;
  const totalText = totalValue === undefined ? null : String(totalValue);
  const total = totalText === null || !/^\d+$/.test(totalText) ? null : Number(totalText);
  if (totalValue !== undefined && (!Number.isSafeInteger(total) || total === null)) {
    throw new Error('Miaoshou list response contains an invalid total');
  }
  return {
    pageNo: request.pageNo,
    pageSize: request.pageSize,
    total,
    hasMore:
      total === null
        ? items.length === request.pageSize
        : request.pageNo * request.pageSize < total,
    items: items.map((item) => ({
      ...item,
      sites: item.collectBoxDetailShop?.sites ?? [],
    })),
  };
}
