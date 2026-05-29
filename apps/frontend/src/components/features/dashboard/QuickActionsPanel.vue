<script setup lang="ts">
import { t } from '@/i18n';
import { useCan } from '@/composables/useCan';
import { RoleName } from '@/types/enums';
import DashboardSection from './DashboardSection.vue';
import QuickActionButton from './QuickActionButton.vue';

const { can } = useCan();

const WRITE_CUSTOMERS: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
const WRITE_CONTRACTS: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
const WRITE_PROJECTS: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ENGINEER];
const WRITE_MATERIALS: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
const WRITE_TEMPLATES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
</script>

<template>
  <DashboardSection :title="t('dashboard.quickActions.title')" icon="mdi-lightning-bolt-outline">
    <div class="p-2 flex flex-col gap-0.5">
      <QuickActionButton
        v-if="can(WRITE_CONTRACTS)"
        to="/contracts/new"
        icon="mdi-file-sign"
        :label="t('dashboard.quickActions.newContract')"
      />
      <QuickActionButton
        v-if="can(WRITE_PROJECTS)"
        to="/projects/new"
        icon="mdi-rocket-launch-outline"
        :label="t('dashboard.quickActions.newProject')"
      />
      <QuickActionButton
        v-if="can(WRITE_CUSTOMERS)"
        to="/customers/new"
        icon="mdi-account-plus-outline"
        :label="t('dashboard.quickActions.newCustomer')"
      />
      <QuickActionButton
        v-if="can(WRITE_MATERIALS)"
        to="/materials/new"
        icon="mdi-cube-outline"
        :label="t('dashboard.quickActions.newMaterial')"
      />
      <QuickActionButton
        v-if="can(WRITE_TEMPLATES)"
        to="/templates/new"
        icon="mdi-file-document-multiple-outline"
        :label="t('dashboard.quickActions.newTemplate')"
      />
    </div>
  </DashboardSection>
</template>
