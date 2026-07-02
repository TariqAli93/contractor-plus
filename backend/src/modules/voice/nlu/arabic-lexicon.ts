// ============================================================
// Arabic lexicon for the rule-based NLU provider.
//
// This is DATA, not logic. Recognising new phrasings of an existing intent =
// add words here. Recognising a brand-new intent = add a block here + register
// a handler. The matcher (rule-based.provider.ts) never hard-codes a sentence.
//
// All entries are written in NORMALISED form (see normalize.ts): no hamza
// variants, ة→ه, ى→ي. Keep them normalised or they will never match.
// ============================================================

import { VoiceIntent } from '@contractor-plus/shared';

export interface IntentLexicon {
  intent: VoiceIntent;
  /** Action cues — "do something" verbs. */
  verbs: string[];
  /** Object cues — the thing being acted on. */
  nouns: string[];
  /** Standalone phrases that imply the intent on their own (normalised). */
  phrases?: string[];
  /** Tokens that strongly boost this intent when present. */
  boosters?: string[];
}

// Create-family verbs shared across "create" intents.
const CREATE_VERBS = [
  'سوي',
  'سويلي',
  'سو',
  'انشئ',
  'انشا',
  'انشي',
  'اعمل',
  'اعمللي',
  'ضيف',
  'اضيف',
  'اضف',
  'اريد',
  'ابدا',
  'ابدي',
  'افتح', // "افتح مشروع جديد" — disambiguated from navigate by the "جديد"/indefinite noun
  'جديد',
];

export const INTENT_LEXICON: IntentLexicon[] = [
  {
    intent: VoiceIntent.CREATE_PROJECT,
    verbs: CREATE_VERBS,
    nouns: ['مشروع', 'بيت', 'دار', 'عماره', 'بنايه', 'فيلا', 'محل'],
    boosters: ['جديد', 'قالب', 'مساحه', 'واجهه', 'نزال'],
  },
  {
    intent: VoiceIntent.CREATE_CONTRACT,
    verbs: CREATE_VERBS,
    nouns: ['عقد', 'العقد', 'كونتراكت'],
    boosters: ['باسم', 'عميل'],
  },
  {
    intent: VoiceIntent.ADD_COST,
    verbs: ['ضيف', 'اضيف', 'اضف', 'سجل', 'احسب', 'اشتريت', 'اشتري', 'شريت', 'صرفت'],
    nouns: [
      'مصروف',
      'مصاريف',
      'كلفه',
      'تكلفه',
      'صرف',
      'شراء',
      // common materials so "اشتريت حديد …" reads as a cost
      'حديد',
      'سمنت',
      'اسمنت',
      'طابوق',
      'بلوك',
      'رمل',
      'حصى',
      'كاشي',
      'سيراميك',
    ],
    boosters: ['بقيمه', 'كيس', 'دينار'],
  },
  {
    intent: VoiceIntent.ADD_PAYMENT,
    verbs: ['ضيف', 'اضيف', 'اضف', 'سجل', 'استلم', 'استلمت', 'دفع', 'دفعت', 'واصل'],
    nouns: ['دفعه', 'دفع', 'تسديد', 'واصل', 'الزبون'],
    boosters: ['مليون', 'اولى'],
  },
  {
    intent: VoiceIntent.ADD_MATERIALS,
    verbs: ['ضيف', 'اضيف', 'اضف', 'احسب'],
    nouns: ['مواد', 'المواد', 'ماده'],
    phrases: ['ضيف المواد المناسبه', 'المواد المناسبه'],
  },
  {
    intent: VoiceIntent.LINK_PROJECT_CONTRACT,
    verbs: ['اربط', 'ربط', 'اربطه', 'اوصل', 'الحق', 'اضم'],
    nouns: ['العقد', 'عقد', 'بالعقد', 'المشروع', 'مشروع'],
    phrases: ['اربط المشروع بالعقد', 'اربطه بالعقد', 'اربط بالعقد'],
    boosters: ['رقم', 'بالعقد'],
  },
  {
    intent: VoiceIntent.NAVIGATE,
    verbs: ['روح', 'افتح', 'اعرض', 'انتقل', 'ودني', 'رجعني', 'وريني'],
    nouns: [
      'المشاريع',
      'العملاء',
      'العقود',
      'المواد',
      'المصاريف',
      'الدفعات',
      'التقارير',
      'لوحه',
      'الرئيسيه',
      'الاعدادات',
    ],
  },
  {
    intent: VoiceIntent.OPEN_ENTITY,
    verbs: ['افتح', 'اعرض', 'روح', 'وريني'],
    nouns: ['مشروع', 'عميل', 'عقد'],
    boosters: ['اسمه', 'باسم', 'رقم'],
  },
  {
    intent: VoiceIntent.HELP,
    verbs: [],
    nouns: [],
    phrases: ['مساعده', 'شنو تكدر تسوي', 'شلون استخدمك', 'help'],
  },
  {
    intent: VoiceIntent.CANCEL,
    verbs: [],
    nouns: [],
    phrases: ['الغاء', 'الغ', 'لا', 'تراجع', 'كنسل', 'cancel'],
  },
  {
    intent: VoiceIntent.CONFIRM,
    verbs: [],
    nouns: [],
    phrases: ['نعم', 'اي', 'اكد', 'تمام', 'موافق', 'زين', 'ok', 'yes'],
  },
];

// ---- navigation route map (normalised section keyword → SPA route) ----
export const ROUTE_MAP: Record<string, string> = {
  المشاريع: '/projects',
  مشاريع: '/projects',
  العملاء: '/customers',
  عملاء: '/customers',
  العقود: '/contracts',
  عقود: '/contracts',
  المواد: '/materials',
  مواد: '/materials',
  المصاريف: '/costs',
  مصاريف: '/costs',
  الدفعات: '/payments',
  دفعات: '/payments',
  التقارير: '/reports',
  تقارير: '/reports',
  لوحه: '/',
  الرئيسيه: '/',
  الاعدادات: '/settings',
};

// ---- project-type lexicon (normalised noun → ProjectType) ----
export const PROJECT_TYPE_MAP: Record<string, 'house' | 'building' | 'shop' | 'villa'> = {
  بيت: 'house',
  دار: 'house',
  عماره: 'building',
  بنايه: 'building',
  فيلا: 'villa',
  محل: 'shop',
};

// Tokens that should never be captured as a person's name.
export const NAME_STOPWORDS = new Set<string>([
  'و',
  'ضيف',
  'اضيف',
  'سوي',
  'المواد',
  'مواد',
  'المناسبه',
  'مشروع',
  'عقد',
  'قالب',
  'بمساحه',
  'مساحه',
  'واجهه',
  'نزال',
  'متر',
  'وسوي',
  'وضيف',
]);
