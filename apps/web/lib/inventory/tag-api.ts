import { api } from '@/lib/api';
import { shrinkPhoto } from './photo';
import type {
  LabelGaps, LabelRun, LookupResult, PaidFrom, ReservedLabels, ReturnedUnsoldResult, RollCallRecord, RollCallSent,
  Tag, TagPhotoRef, TagStatus, WriteOffReason,
} from './tags';

/**
 * The tag API (tasks/inventory-phase1-api.md), one function per route, so the
 * Inventory screens and the till call it the same way.
 */

export interface NewTag {
  number: string;
  productId: string;
  branchId: string;
  engineNumber?: string;
  chassisNumber?: string;
  notes?: string;
}

export const createTag = (body: NewTag) =>
  api.post<Tag>('/tags', body).then((r) => r.data);

/** One photo, scaled down first (see photo.ts), sent as multipart field "file". */
export async function uploadTagPhoto(tagId: string, file: File): Promise<TagPhotoRef> {
  const small = await shrinkPhoto(file);
  const form = new FormData();
  form.append('file', small, small.name);
  return api
    .post<TagPhotoRef>(`/tags/${encodeURIComponent(tagId)}/photos`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // A photo on mobile data can take a while; the default has no limit, keep it generous but finite.
      timeout: 120_000,
    })
    .then((r) => r.data);
}

export const lookupCode = (code: string, branchId?: string | null) =>
  api
    .get<LookupResult>('/tags/lookup', { params: { code, branchId: branchId || undefined } })
    .then((r) => r.data);

export const listTags = (params: { status?: TagStatus | ''; branchId?: string; q?: string }) =>
  api
    .get<Tag[]>('/tags', {
      params: {
        status: params.status || undefined,
        branchId: params.branchId || undefined,
        q: params.q?.trim() || undefined,
      },
    })
    .then((r) => r.data);

export const costTag = (tagId: string, cost: number, paidFrom: PaidFrom) =>
  api.post<Tag>(`/tags/${encodeURIComponent(tagId)}/cost`, { cost, paidFrom }).then((r) => r.data);

export const reserveLabels = (count: number) =>
  api.post<ReservedLabels>('/tags/labels/reserve', { count }).then((r) => r.data);

export const listLabelRuns = () =>
  api.get<LabelRun[]>('/tags/labels/runs').then((r) => r.data);

export const sendRollCall = (branchId: string, numbers: string[]) =>
  api.post<RollCallSent>('/tags/roll-call', { branchId, numbers }).then((r) => r.data);

export const listRollCalls = (branchId?: string | null) =>
  api.get<RollCallRecord[]>('/tags/roll-calls', { params: { branchId: branchId || undefined } }).then((r) => r.data);

export const reportReturnedUnsold = (number: string, note?: string) =>
  api.post<ReturnedUnsoldResult>('/tags/returned-unsold', { number, note: note?.trim() || undefined }).then((r) => r.data);

/** Owner only: the part's photo with its number showing goes with the reason. */
export async function writeOffTag(tagId: string, reason: WriteOffReason, note: string, file: File) {
  const small = await shrinkPhoto(file);
  const form = new FormData();
  form.append('file', small, small.name);
  form.append('reason', reason);
  if (note.trim()) form.append('note', note.trim());
  return api
    .post<{ number: string; status: 'RETIRED'; bookedTo: string | null }>(`/tags/${encodeURIComponent(tagId)}/write-off`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120_000,
    })
    .then((r) => r.data);
}

export const labelGaps = () =>
  api.get<LabelGaps>('/tags/labels/gaps').then((r) => r.data);
