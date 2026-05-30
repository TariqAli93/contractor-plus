<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/i18n';
import { useAccess } from '@/composables/useAccess';
import { RoleName } from '@/types/enums';
import DashboardSection from './DashboardSection.vue';
import QuickActionButton from './QuickActionButton.vue';

const { canAccess } = useAccess();

// Permission-first with legacy write-role fallback.
const WRITE_CUSTOMERS: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
const WRITE_CONTRACTS: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
const WRITE_PROJECTS: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ENGINEER];
const WRITE_MATERIALS: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
const WRITE_TEMPLATES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];

const canNewContract = computed(() => canAccess({ permissions: ['contracts.create'], roles: WRITE_CONTRACTS }));
const canNewProject = computed(() => canAccess({ permissions: ['projects.create'], roles: WRITE_PROJECTS }));
const canNewCustomer = computed(() => canAccess({ permissions: ['customers.create'], roles: WRITE_CUSTOMERS }));
const canNewMaterial = computed(() => canAccess({ permissions: ['materials.create'], roles: WRITE_MATERIALS }));
const canNewTemplate = computed(() => canAccess({ permissions: ['templates.create'], roles: WRITE_TEMPLATES }));
</script>

<template>
  <DashboardSection :title="t('dashboard.quickActions.title')" icon="mdi-lightning-bolt-outline">
    <div class="p-2 flex flex-col gap-0.5">
      <QuickActionButton
        v-if="canNewContract"
        to="/contracts/new"
        icon="mdi-file-sign"
        :label="t('dashboard.quickActions.newContract')"
      />
      <QuickActionButton
        v-if="canNewProject"
        to="/projects/new"
        icon="mdi-rocket-launch-outline"
        :label="t('dashboard.quickActions.newProject')"
      />
      <QuickActionButton
        v-if="canNewCustomer"
        to="/customers/new"
        icon="mdi-account-plus-outline"
        :label="t('dashboard.quickActions.newCustomer')"
      />
      <QuickActionButton
        v-if="canNewMaterial"
        to="/materials/new"
        icon="mdi-cube-outline"
        :label="t('dashboard.quickActions.newMaterial')"
      />
      <QuickActionButton
        v-if="canNewTemplate"
        to="/templates/new"
        icon="mdi-file-document-multiple-outline"
        :label="t('dashboard.quickActions.newTemplate')"
      />
    </div>
  </DashboardSection>
</template>
