export type SubscriptionTier = 'TIER_1' | 'TIER_2' | 'TIER_3';
export type TenantStatus = 'ACTIVE' | 'GRACE' | 'SUSPENDED';
export type InventoryMode = 'UNIT_BASED' | 'RECIPE_BASED';
export type ValuationMethod = 'WAC' | 'FIFO';

/** Business type — determines default chart of accounts on tenant onboarding */
export type BusinessType = 'COFFEE_SHOP' | 'RETAIL' | 'SERVICE' | 'MANUFACTURING';

export interface TenantContext {
  id: string;
  name: string;
  tier: SubscriptionTier;
  status: TenantStatus;
  businessType: BusinessType;
  branchQuota: number;
  cashierSeatQuota: number;
  hasTimeMonitoring: boolean;
  hasBirForms: boolean;
}
