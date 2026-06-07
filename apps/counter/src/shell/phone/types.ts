/**
 * Clerque Counter — Phone navigator param lists.
 */
export type PhoneSellStackParamList = {
  SellList: undefined;
  Modifier: { productId: string };
  Cart: undefined;
  Tendering: undefined;
};

export type PhoneMoreStackParamList = {
  MoreRoot: undefined;
  Approvals: undefined;
  Displays: undefined;
  Printer: undefined;
  Settings: undefined;
  Pickups: undefined;
  CloseAndPlan: undefined;
};

export type PhoneTabParamList = {
  Dashboard: undefined;
  Sell: undefined;
  Pumps: undefined;       // GAS_STATION vertical replaces Sell with Pumps
  Rentals: undefined;     // MEDICAL_EQUIPMENT adds a Rentals tab
  Orders: undefined;
  Shift: undefined;
  More: undefined;
};
