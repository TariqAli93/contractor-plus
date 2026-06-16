import { computed, onMounted } from 'vue';
import { useSettingsStore } from '@/stores/settings.store';
import { formatMoney, type FormatMoneyOptions } from '@/lib/currency-format';

// Reactive money-formatter bound to the default currency in the settings
// store. Components consuming this composable automatically re-render when
// the user changes the default currency in the Settings UI.
export function useCurrencyFormat() {
  const settings = useSettingsStore();

  // Trigger lazy load on first mount — but only ONCE across the app.
  // ensureLoaded() de-dupes concurrent and repeated calls.
  onMounted(() => {
    void settings.ensureLoaded();
  });

  const currency = computed(() => settings.defaultCurrency);

  function format(
    amount: number | string | null | undefined,
    opts: Omit<FormatMoneyOptions, 'currency'> = {},
  ): string {
    return formatMoney(amount, { ...opts, currency: currency.value });
  }

  return {
    currency,
    format,
  };
}
