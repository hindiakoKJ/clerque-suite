import { api } from '@/lib/api';
import type { ActiveShift } from '@/store/pos/shift';

export async function fetchActiveShift(branchId: string): Promise<ActiveShift | null> {
  const { data } = await api.get(`/shifts/active?branchId=${branchId}`);
  return data ?? null;
}

export async function openShift(branchId: string, openingCash: number, notes?: string): Promise<ActiveShift> {
  const { data } = await api.post('/shifts', { branchId, openingCash, notes });
  return data as ActiveShift;
}

export async function closeShift(shiftId: string, closingCashDeclared: number, notes?: string) {
  const { data } = await api.post(`/shifts/${shiftId}/close`, { closingCashDeclared, notes });
  return data;
}

export async function getShiftSummary(shiftId: string): Promise<ActiveShift> {
  const { data } = await api.get(`/shifts/${shiftId}`);
  return data as ActiveShift;
}
