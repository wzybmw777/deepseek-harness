/** Dictionaries for the enterprise token quota surface. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'enterpriseQuota'

/** Simplified Chinese dictionary, the key-set source of truth. */
export const zh = {
  'quota.loading': '正在读取额度',
  'quota.remaining': '本月剩余 {tokens} Tokens',
  'quota.personal': '我的用量 {tokens}',
  'quota.exhausted': '额度已用完',
  'quota.purchase': '购买套餐',
  'quota.unavailable': '额度暂时无法读取',
  'quota.retry': '重试',
} as const

/** Every locale checked complete against the Chinese key set. */
type Dictionary = { readonly [K in keyof typeof zh]: string }

export const en: Dictionary = {
  'quota.loading': 'Reading quota',
  'quota.remaining': '{tokens} Tokens left this month',
  'quota.personal': 'My usage {tokens}',
  'quota.exhausted': 'Quota exhausted',
  'quota.purchase': 'View plans',
  'quota.unavailable': 'Quota unavailable',
  'quota.retry': 'Retry',
}

export const ja: Dictionary = {
  'quota.loading': '利用枠を読み込み中',
  'quota.remaining': '今月の残り {tokens} Tokens',
  'quota.personal': '自分の使用量 {tokens}',
  'quota.exhausted': '利用枠を使い切りました',
  'quota.purchase': 'プランを見る',
  'quota.unavailable': '利用枠を取得できません',
  'quota.retry': '再試行',
}

export const es: Dictionary = {
  'quota.loading': 'Cargando cuota',
  'quota.remaining': 'Quedan {tokens} Tokens este mes',
  'quota.personal': 'Mi uso {tokens}',
  'quota.exhausted': 'Cuota agotada',
  'quota.purchase': 'Ver planes',
  'quota.unavailable': 'Cuota no disponible',
  'quota.retry': 'Reintentar',
}

export const fr: Dictionary = {
  'quota.loading': 'Lecture du quota',
  'quota.remaining': '{tokens} Tokens restants ce mois-ci',
  'quota.personal': 'Mon utilisation {tokens}',
  'quota.exhausted': 'Quota épuisé',
  'quota.purchase': 'Voir les offres',
  'quota.unavailable': 'Quota indisponible',
  'quota.retry': 'Réessayer',
}

export const de: Dictionary = {
  'quota.loading': 'Kontingent wird geladen',
  'quota.remaining': 'Diesen Monat noch {tokens} Tokens',
  'quota.personal': 'Meine Nutzung {tokens}',
  'quota.exhausted': 'Kontingent aufgebraucht',
  'quota.purchase': 'Tarife ansehen',
  'quota.unavailable': 'Kontingent nicht verfügbar',
  'quota.retry': 'Erneut versuchen',
}

export const ru: Dictionary = {
  'quota.loading': 'Загрузка квоты',
  'quota.remaining': 'Осталось {tokens} Tokens в этом месяце',
  'quota.personal': 'Мой расход {tokens}',
  'quota.exhausted': 'Квота исчерпана',
  'quota.purchase': 'Посмотреть тарифы',
  'quota.unavailable': 'Квота недоступна',
  'quota.retry': 'Повторить',
}

export const pt: Dictionary = {
  'quota.loading': 'Carregando cota',
  'quota.remaining': 'Restam {tokens} Tokens neste mês',
  'quota.personal': 'Meu uso {tokens}',
  'quota.exhausted': 'Cota esgotada',
  'quota.purchase': 'Ver planos',
  'quota.unavailable': 'Cota indisponível',
  'quota.retry': 'Tentar novamente',
}

export type EnterpriseQuotaKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    enterpriseQuota: EnterpriseQuotaKey
  }
}
