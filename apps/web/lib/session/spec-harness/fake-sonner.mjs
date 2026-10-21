/** Stand-in for 'sonner': the real one injects its CSS into a DOM at import. */
export const toasts = [];
const say = (kind) => (msg) => { toasts.push({ kind, msg }); };
export const toast = Object.assign(say('info'), {
  success: say('success'), error: say('error'), warning: say('warning'), info: say('info'),
});
