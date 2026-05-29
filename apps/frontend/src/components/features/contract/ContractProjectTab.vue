<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ContractStatus } from '@/types/enums';
import type { ContractWithRelations } from '@/types/contract';
import DateDisplay from '@/components/shared/DateDisplay.vue';

const props = defineProps<{ contract: ContractWithRelations }>();
const { t } = useI18n();

const hasProject = computed(() => props.contract.project !== null);

const guidance = computed(() => {
  if (hasProject.value) return null;
  if (props.contract.status === ContractStatus.DRAFT) return t('contracts.project.draftHint');
  if (props.contract.status === ContractStatus.CANCELLED) return t('contracts.project.cancelledHint');
  return t('contracts.project.approvedHint');
});
</script>

<template>
  <div>
    <h2 class="text-h6 mb-3">{{ t('contracts.project.title') }}</h2>

    <template v-if="hasProject && contract.project">
      <v-card variant="outlined">
        <v-card-text class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div class="text-medium-emphasis text-xs">{{ t('contracts.project.fields.name') }}</div>
            <div class="text-h6">{{ contract.project.name }}</div>
          </div>
          <div>
            <div class="text-medium-emphasis text-xs">{{ t('contracts.project.fields.status') }}</div>
            <v-chip size="small" variant="tonal">{{ contract.project.status }}</v-chip>
          </div>
          <div>
            <div class="text-medium-emphasis text-xs">{{ t('contracts.project.fields.startDate') }}</div>
            <DateDisplay :value="contract.project.startDate" />
          </div>
          <div>
            <div class="text-medium-emphasis text-xs">{{ t('contracts.project.fields.deliveryDate') }}</div>
            <DateDisplay :value="contract.project.deliveryDate" />
          </div>
          <div class="md:col-span-2">
            <div class="text-medium-emphasis text-xs">{{ t('contracts.project.fields.progress') }}</div>
            <v-progress-linear
              :model-value="Number(contract.project.progressPercentage)"
              height="20"
              color="primary"
              rounded
            >
              <template #default>
                <span class="text-caption">{{ contract.project.progressPercentage }}%</span>
              </template>
            </v-progress-linear>
          </div>
        </v-card-text>
        <v-divider />
        <v-card-actions>
          <v-spacer />
          <v-btn
            color="primary"
            variant="tonal"
            prepend-icon="mdi-arrow-top-left"
            :to="`/projects/${contract.project.id}`"
          >
            {{ t('contracts.actions.viewProject') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </template>

    <v-alert v-else type="info" variant="tonal" icon="mdi-information-outline">
      {{ guidance }}
    </v-alert>
  </div>
</template>
