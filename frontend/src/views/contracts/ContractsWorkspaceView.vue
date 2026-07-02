<script setup lang="ts">
// Master-detail contracts workspace (roadmap Phase 2, "single screen"): a
// compact searchable contract list on the start side; the selected contract's
// full detail on the other — no page hop. Narrow screens fall back to the
// full-page detail. Selection is mirrored to ?p= for refresh/shareable links.
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDisplay } from 'vuetify';
import { t } from '@/i18n';
import { useContracts } from '@/composables/useContracts';
import { ContractStatus, RoleName } from '@/types/enums';
import type { Contract } from '@/types/contract';
import SearchBar from '@/components/shared/SearchBar.vue';
import PageHeader from '@/components/shared/PageHeader.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import RoleGate from '@/components/shared/RoleGate.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import ContractStatusBadge from '@/components/features/contract/ContractStatusBadge.vue';
import ContractDetailPanel from '@/components/features/contract/ContractDetailPanel.vue';

// The list join carries the customer object at runtime (typed as Contract).
type ContractRow = Contract & { customer?: { name: string } };

const route = useRoute();
const router = useRouter();
// Match the Tailwind `lg:` (1024px) split layout below.
const { width } = useDisplay();
const isSplit = computed(() => width.value >= 1024);

const { items, total, loading, error, page, pageSize, searchInput, status, fetch, setStatusFilter } =
  useContracts();

const WRITE_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
const WRITE_PERMS = ['contracts.create', 'contracts.update', 'contracts.delete'];

const selectedId = ref<string | undefined>(
  typeof route.query.p === 'string' ? route.query.p : undefined,
);

const statusFilter = computed<'all' | ContractStatus>(() => status.value ?? 'all');
function onStatusChange(v: 'all' | ContractStatus) {
  setStatusFilter(v === 'all' ? undefined : v);
}

function select(c: Contract) {
  if (isSplit.value) {
    selectedId.value = c.id;
    void router.replace({ query: { ...route.query, p: c.id } });
  } else {
    void router.push(`/contracts/${c.id}`);
  }
}

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

onMounted(fetch);
</script>

<template>
  <div>
    <PageHeader :title="t('nav.contracts')" :count="total || null" icon="mdi-file-sign">
      <RoleGate :permissions="WRITE_PERMS" :roles="WRITE_ROLES">
        <v-btn color="primary" prepend-icon="mdi-plus" to="/contracts/new">
          {{ t('contracts.new') }}
        </v-btn>
      </RoleGate>
    </PageHeader>

    <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <!-- Master -->
      <div class="lg:col-span-4">
        <v-card>
          <v-card-text class="pb-2">
            <SearchBar v-model="searchInput" :placeholder="t('contracts.searchPlaceholder')" />
            <v-chip-group
              :model-value="statusFilter"
              mandatory
              selected-class="bg-primary text-white"
              class="mt-1"
              @update:model-value="onStatusChange"
            >
              <v-chip value="all" size="x-small">{{ t('contracts.filter.all') }}</v-chip>
              <v-chip :value="ContractStatus.DRAFT" size="x-small">{{ t('contracts.status.DRAFT') }}</v-chip>
              <v-chip :value="ContractStatus.APPROVED" size="x-small">{{ t('contracts.status.APPROVED') }}</v-chip>
              <v-chip :value="ContractStatus.CANCELLED" size="x-small">{{ t('contracts.status.CANCELLED') }}</v-chip>
            </v-chip-group>
          </v-card-text>

          <v-divider />

          <ErrorState v-if="error" :error="error" class="my-4" @retry="fetch" />
          <template v-else>
            <v-progress-linear v-if="loading" indeterminate />
            <div class="cp-master-list">
              <button
                v-for="c in (items as ContractRow[])"
                :key="c.id"
                type="button"
                class="cp-master-item"
                :class="{ 'is-active': c.id === selectedId }"
                @click="select(c)"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="cp-master-name">{{ c.contractNumber }}</span>
                  <ContractStatusBadge :status="c.status" />
                </div>
                <div class="text-caption text-medium-emphasis">{{ c.customer?.name ?? '—' }}</div>
                <div class="text-caption font-medium mt-1"><MoneyDisplay :amount="c.totalPrice" /></div>
              </button>
              <div v-if="!loading && items.length === 0" class="cp-master-empty">
                {{ t('common.empty') }}
              </div>
            </div>

            <template v-if="pageCount > 1">
              <v-divider />
              <div class="pa-2 d-flex justify-center">
                <v-pagination v-model="page" :length="pageCount" :total-visible="4" density="comfortable" />
              </div>
            </template>
          </template>
        </v-card>
      </div>

      <!-- Detail -->
      <div class="lg:col-span-8">
        <template v-if="selectedId">
          <div class="d-flex justify-end mb-2">
            <v-btn
              variant="text"
              size="small"
              prepend-icon="mdi-open-in-new"
              :to="`/contracts/${selectedId}`"
            >
              {{ t('contracts.openFull') }}
            </v-btn>
          </div>
          <ContractDetailPanel :contract-id="selectedId" @changed="fetch" />
        </template>
        <v-card v-else class="cp-detail-empty">
          <div class="text-center text-medium-emphasis pa-12">
            <v-icon size="48" class="mb-3 d-block mx-auto">mdi-gesture-tap</v-icon>
            {{ t('contracts.workspace.selectHint') }}
          </div>
        </v-card>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cp-master-list {
  max-height: calc(100vh - 300px);
  min-height: 200px;
  overflow-y: auto;
}
.cp-master-item {
  display: block;
  width: 100%;
  text-align: start;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(var(--v-border-color), 0.4);
  cursor: pointer;
}
.cp-master-item:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.cp-master-item.is-active {
  background: rgba(var(--v-theme-primary), 0.1);
  border-inline-start: 3px solid rgb(var(--v-theme-primary));
}
.cp-master-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cp-master-empty {
  padding: 36px;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.cp-detail-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 320px;
}
</style>
