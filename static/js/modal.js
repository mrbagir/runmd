import { escapeHtml } from './util.js';

function dialog({
  title,
  message = '',
  input = false,
  defaultValue = '',
  placeholder = '',
  confirmText = 'OK',
  danger = false,
}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop select-none';
    backdrop.innerHTML = `
      <div class="modal-card">
        <div class="space-y-1.5">
          <h3 class="font-semibold text-sm text-[#f4f4f8]">${escapeHtml(title)}</h3>
          ${message ? `<p class="text-[#8e8e99] text-xs leading-relaxed">${escapeHtml(message)}</p>` : ''}
        </div>
        ${input ? `<div><input type="text" class="w-full bg-[#0d0d10] border border-[#2b2b36] rounded px-3 py-1.5 text-xs text-[#ededf0] focus:border-[#7c6cf0] focus:outline-none" placeholder="${escapeHtml(placeholder)}" /></div>` : ''}
        <div class="flex justify-end gap-2 pt-1">
          <button type="button" class="btn-cancel px-3 py-1.5 rounded bg-[#1e1e24] hover:bg-[#282830] text-[#a0a0ab] hover:text-[#ededf0] transition text-xs font-medium">Batal</button>
          <button type="button" class="btn-confirm px-3 py-1.5 rounded ${danger ? 'bg-[#3d1820] hover:bg-[#521e2a] text-[#f43f5e] border border-[#521e2a]' : 'bg-[#2b2659] hover:bg-[#393175] text-[#d6d0ff] hover:text-white'} transition text-xs font-medium">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const inputEl = backdrop.querySelector('input');
    const close = (val) => {
      window.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(input ? null : false);
      if (e.key === 'Enter') close(input ? inputEl.value.trim() : true);
    };

    window.addEventListener('keydown', onKey);
    backdrop.querySelector('.btn-cancel').onclick = () => close(input ? null : false);
    backdrop.querySelector('.btn-confirm').onclick = () => close(input ? inputEl.value.trim() : true);
    backdrop.onclick = (e) => {
      if (e.target === backdrop) close(input ? null : false);
    };

    if (inputEl) {
      inputEl.value = defaultValue;
      inputEl.focus();
      inputEl.select();
    } else {
      backdrop.querySelector('.btn-confirm').focus();
    }
  });
}

export const showPromptModal = (opts) => dialog({ ...opts, input: true });
export const showConfirmModal = (opts) => dialog({ ...opts, input: false });

export function showToast(message, type = 'info', durationMs = 2500) {
  let box = document.getElementById('toastContainer');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toastContainer';
    box.className = 'toast-container';
    document.body.appendChild(box);
  }
  const toast = document.createElement('div');
  const color =
    type === 'success'
      ? 'border-[#1b3a2b] bg-[#102219]/95 text-[#a7f3d0]'
      : type === 'error'
      ? 'border-[#4a1a24] bg-[#220d13]/95 text-[#fecdd3]'
      : 'border-[#292938] bg-[#14141c]/95 text-[#ededf2]';
  toast.className = `toast-item border ${color}`;
  toast.textContent = message;
  box.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px) scale(0.96)';
    setTimeout(() => toast.remove(), 200);
  }, durationMs);
}
