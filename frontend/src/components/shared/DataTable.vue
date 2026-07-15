<script setup lang="ts">
/**
 * The single server-data table contract for list workspaces.  Filtering lives
 * in the compact command bar above it; this component owns the consistent
 * dense rendering, sticky headings, pagination and event forwarding.
 */
defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    headers: readonly object[];
    items: readonly object[];
    itemsLength: number;
    loading?: boolean;
    page?: number;
    itemsPerPage?: number;
    itemsPerPageOptions?: number[];
    itemValue?: string;
    ariaLabel?: string;
    /** Local tables own their sort and paging; operational lists stay server-driven. */
    server?: boolean;
  }>(),
  {
    loading: false,
    page: 1,
    itemsPerPage: 50,
    itemsPerPageOptions: () => [25, 50, 100, 200],
    itemValue: 'id',
    ariaLabel: 'جدول البيانات',
    server: true,
  },
);

defineEmits<{
  (event: 'update:options', options: any): void;
  (event: 'click:row', eventData: any, row: any): void;
  (event: 'dblclick:row', eventData: any, row: any): void;
}>();
</script>

<template>
  <v-data-table-server
    v-if="server"
    v-bind="$attrs"
    class="cp-smart-table"
    :headers="headers"
    :items="items"
    :items-length="itemsLength"
    :loading="loading"
    :page="page"
    :items-per-page="itemsPerPage"
    :items-per-page-options="itemsPerPageOptions"
    :item-value="itemValue"
    :aria-label="ariaLabel"
    density="compact"
    fixed-header
    hover
    @update:options="$emit('update:options', $event)"
    @click:row="(eventData: any, row: any) => $emit('click:row', eventData, row)"
    @dblclick:row="(eventData: any, row: any) => $emit('dblclick:row', eventData, row)"
  >
    <template v-for="(_, slotName) in $slots" :key="slotName" #[slotName]="slotProps">
      <slot :name="slotName" v-bind="slotProps ?? {}" />
    </template>
  </v-data-table-server>

  <v-data-table
    v-else
    v-bind="$attrs"
    class="cp-smart-table"
    :headers="headers"
    :items="items"
    :loading="loading"
    :page="page"
    :items-per-page="itemsPerPage"
    :items-per-page-options="itemsPerPageOptions"
    :item-value="itemValue"
    :aria-label="ariaLabel"
    density="compact"
    fixed-header
    hover
    @update:options="$emit('update:options', $event)"
    @click:row="(eventData: any, row: any) => $emit('click:row', eventData, row)"
    @dblclick:row="(eventData: any, row: any) => $emit('dblclick:row', eventData, row)"
  >
    <template v-for="(_, slotName) in $slots" :key="slotName" #[slotName]="slotProps">
      <slot :name="slotName" v-bind="slotProps ?? {}" />
    </template>
  </v-data-table>
</template>

<style scoped>
.cp-smart-table {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.cp-smart-table :deep(.v-table__wrapper) {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
</style>
