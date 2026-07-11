<script setup lang="ts">
import { ref } from 'vue';
import { t } from '@/i18n';
import { useToast } from '@/composables/useToast';

// Read-only reference of every {{token}} the renderer supports. Grouping
// here mirrors the backend's PLACEHOLDER_GROUPS - keep in sync when adding
// new tokens.

interface PlaceholderGroup {
  titleKey: string;
  tokens: string[];
}

const GROUPS: PlaceholderGroup[] = [
  {
    titleKey: 'documentTemplates.placeholders.groups.company',
    tokens: [
      'company_name',
      'company_email',
      'company_phone',
      'company_address',
      'company_tax_number',
    ],
  },
  {
    titleKey: 'documentTemplates.placeholders.groups.customer',
    tokens: ['client_name', 'client_phone', 'client_address'],
  },
  {
    titleKey: 'documentTemplates.placeholders.groups.project',
    tokens: [
      'project_name',
      'project_location',
      'project_start_date',
      'project_delivery_date',
      'project_progress',
    ],
  },
  {
    titleKey: 'documentTemplates.placeholders.groups.contract',
    tokens: ['contract_number', 'contract_date', 'contract_total', 'contract_status'],
  },
  {
    titleKey: 'documentTemplates.placeholders.groups.currency',
    tokens: ['currency_symbol'],
  },
];

const toast = useToast();
const copied = ref<string | null>(null);

const placeholderText = (token: string) => `{{${token}}}`;

async function copy(token: string) {
  const text = `{{${token}}}`;
  try {
    await navigator.clipboard.writeText(text);
    copied.value = token;
    toast.success(t('documentTemplates.placeholders.copied'));
    window.setTimeout(() => {
      if (copied.value === token) copied.value = null;
    }, 1500);
  } catch {
    toast.error(t('common.error'));
  }
}
</script>

<template>
  <section class="cp-placeholder-ref">
    <header class="cp-placeholder-ref__head">
      <p class="cp-eyebrow mb-1">{{ t('documentTemplates.placeholders.eyebrow') }}</p>
      <h3 class="cp-placeholder-ref__title">{{ t('documentTemplates.placeholders.title') }}</h3>
      <p class="text-sm text-medium-emphasis">
        {{ t('documentTemplates.placeholders.description') }}
      </p>
    </header>
    <div class="cp-placeholder-ref__groups">
      <div v-for="group in GROUPS" :key="group.titleKey" class="cp-placeholder-ref__group">
        <div class="cp-eyebrow mb-1">{{ t(group.titleKey) }}</div>
        <ul class="cp-placeholder-ref__tokens">
          <li v-for="token in group.tokens" :key="token">
            <button
              type="button"
              class="cp-placeholder-ref__chip"
              :class="{ 'cp-placeholder-ref__chip--copied': copied === token }"
              :title="t('documentTemplates.placeholders.copyHint')"
              @click="copy(token)"
            >
              <code v-text="placeholderText(token)" />

              <v-icon
                :icon="copied === token ? 'mdi-check' : 'mdi-content-copy'"
                size="14"
                class="ms-1"
              />
            </button>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.cp-placeholder-ref {
  border: 1px solid var(--cp-border);
  background: var(--cp-surface);
  border-radius: var(--cp-radius-md);
  padding: 18px 20px;
}
.cp-placeholder-ref__head {
  margin-bottom: 14px;
}
.cp-placeholder-ref__title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--cp-text, #1A202C);
}
.cp-placeholder-ref__groups {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
}
.cp-placeholder-ref__group {
  background: var(--cp-surface-2, #E9EEF3);
  border: 1px solid var(--cp-border, #CBD5E0);
  border-radius: var(--cp-radius-xl);
  padding: 10px 12px;
}
.cp-placeholder-ref__tokens {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cp-placeholder-ref__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: var(--cp-radius-md);
  background: transparent;
  border: 1px solid transparent;
  font-size: 0.78rem;
  color: var(--cp-text);
  cursor: pointer;
  transition:
    background-color var(--cp-dur-base) var(--cp-ease),
    border-color var(--cp-dur-base) var(--cp-ease);
  width: 100%;
  justify-content: space-between;
  text-align: start;
}
.cp-placeholder-ref__chip:hover {
  background: var(--cp-primary-soft);
  border-color: var(--cp-primary);
}
.cp-placeholder-ref__chip--copied {
  background: var(--cp-success-soft);
  border-color: var(--cp-success);
}
/* The one sanctioned non-UI face: these are literal template placeholders the
   user copies into a DOCX, so they are code, not label text. */
.cp-placeholder-ref__chip code {
  font-family: var(--cp-font-mono);
}
</style>
