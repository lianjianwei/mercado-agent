import type {
  InfringementDecision,
  RiskLevel,
} from '../shared/infringement-schema';

export type InfringementKind =
  | 'brand_owner'
  | 'compatible_accessory'
  | 'unbranded'
  | 'unknown';

export type InfringementRun = {
  id: string;
  productId: string;
  fingerprint: string;
  version: number;
  level: RiskLevel;
  kind: InfringementKind;
  decision: InfringementDecision;
  createdAt: string;
};

export type InfringementRunInput = Omit<InfringementRun, 'version'> & {
  version?: number;
};

export interface InfringementRepository {
  append(input: InfringementRunInput): InfringementRun;
  listForProduct(productId: string): InfringementRun[];
  currentForProduct(productId: string): InfringementRun | null;
}
