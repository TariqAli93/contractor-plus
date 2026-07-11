<script setup lang="ts">
defineProps<{
  to: string;
  icon: string;
  label: string;
}>();
</script>

<template>
  <RouterLink :to="to" class="cp-quick-action">
    <span class="cp-icon-tile">
      <v-icon :icon="icon" size="20" />
    </span>
    <span class="cp-quick-action__label">{{ label }}</span>
    <v-icon icon="mdi-chevron-left" size="18" class="cp-quick-action__chev" />
  </RouterLink>
</template>

<style scoped>
.cp-quick-action {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--cp-radius-sm);
  background: transparent;
  border: 1px solid transparent;
  color: var(--cp-text);
  text-decoration: none;
  transition: background-color var(--cp-dur-fast) var(--cp-ease),
    border-color var(--cp-dur-fast) var(--cp-ease),
    transform var(--cp-dur-fast) var(--cp-ease);
}
.cp-quick-action:hover {
  background: var(--cp-surface-2);
  border-color: var(--cp-border);
}
.cp-quick-action:active {
  transform: translateY(1px);
}
.cp-quick-action:focus-visible {
  outline: 2px solid var(--cp-primary);
  outline-offset: 2px;
}
.cp-quick-action__label {
  font-size: 0.9rem;
  font-weight: 500;
  flex: 1;
  min-width: 0;
}
.cp-quick-action__chev {
  color: var(--cp-text-subtle);
  transition: transform var(--cp-dur-fast) var(--cp-ease),
    color var(--cp-dur-fast) var(--cp-ease);
}
.cp-quick-action:hover .cp-quick-action__chev {
  color: var(--cp-primary);
  transform: translateX(-3px);
}
/* In LTR layouts the chevron points the wrong way - flip it visually. */
:global([dir='ltr']) .cp-quick-action__chev {
  transform: scaleX(-1);
}
:global([dir='ltr']) .cp-quick-action:hover .cp-quick-action__chev {
  transform: scaleX(-1) translateX(-3px);
}
</style>
