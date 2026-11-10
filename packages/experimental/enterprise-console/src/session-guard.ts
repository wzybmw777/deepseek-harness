/** Browser-side enterprise identity and session revalidation for the Harness page. */

/** Same-origin script injected into the Harness index. */
export const HARNESS_SESSION_GUARD_PATH = '/enterprise/session-guard.js'

/** Product name shown by the enterprise shell and browser title. */
export const ENTERPRISE_BRAND_NAME = '织流'

const SESSION_GUARD_STYLES = String.raw`
  html[data-dsh-enterprise] {
    --dsw-alias-state-business-primary: #3a806b;
  }

  html[data-dsh-enterprise] [data-slot="conversation.hero.agentPreset"],
  html[data-dsh-enterprise] [data-slot="conversation.input.model"],
  html[data-dsh-enterprise] [data-slot="conversation.input.permission"] {
    display: none !important;
  }

  html[data-dsh-enterprise] [data-slot="sidebar.brand.name"] [class*="buildVersion"] {
    display: none !important;
  }

  html[data-dsh-enterprise] [data-slot="sidebar.brand.name"] [class*="localBuildTitle"] {
    font-size: 20px;
    line-height: 24px;
  }

  [data-dsh-enterprise-resources] {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 2px;
    margin-top: 8px;
    margin-bottom: 8px;
    container-type: inline-size;
  }

  .dsh-ent-resource-toggle {
    display: flex;
    min-height: 28px;
    align-items: center;
    gap: 4px;
    padding: 0 9px;
    border: 0;
    border-radius: var(--dsw-radius-md, 12px);
    background: transparent;
    color: var(--dsw-alias-label-tertiary, #7a7f89);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    line-height: 20px;
    text-align: left;
  }

  @media (hover: hover) {
    .dsh-ent-resource-toggle:hover {
      background: var(--dsw-alias-interactive-bg-hover, rgba(120, 125, 140, 0.1));
    }
  }

  .dsh-ent-resource-toggle:focus-visible,
  .dsh-ent-resource-row:focus-visible {
    outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #2563eb));
    outline-offset: -2px;
  }

  .dsh-ent-resource-chevron {
    display: inline-flex;
    flex: none;
    transition: transform 120ms ease;
  }

  [data-dsh-enterprise-resources][data-collapsed="true"] .dsh-ent-resource-chevron {
    transform: rotate(-90deg);
  }

  .dsh-ent-resource-rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  [data-dsh-enterprise-resources][data-collapsed="true"] .dsh-ent-resource-rows {
    display: none;
  }

  .dsh-ent-resource-row {
    display: flex;
    min-height: 36px;
    align-items: center;
    gap: 6px;
    box-sizing: border-box;
    margin: 0;
    padding: 7px 9px;
    border: 0;
    border-inline: 3px solid transparent;
    border-radius: var(--dsw-radius-md, 12px);
    background: transparent;
    background-clip: padding-box;
    color: var(--dsw-alias-label-primary, #17191d);
    cursor: pointer;
    font: inherit;
    line-height: 22px;
    text-decoration: none;
    text-align: left;
  }

  .dsh-ent-resource-row[aria-current="page"] {
    background-color: var(--dsw-alias-interactive-bg-hover, rgba(120, 125, 140, 0.1));
    color: var(--dsw-alias-label-primary, #17191d);
  }

  @media (hover: hover) {
    .dsh-ent-resource-row:hover {
      background-color: var(--dsw-alias-interactive-bg-hover, rgba(120, 125, 140, 0.1));
    }
  }

  .dsh-ent-resource-icon {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    color: var(--dsw-alias-label-secondary, #61666b);
  }

  .dsh-ent-resource-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @container (max-width: 64px) {
    .dsh-ent-resource-toggle,
    .dsh-ent-resource-label {
      display: none;
    }

    .dsh-ent-resource-row,
    [data-dsh-enterprise-resources][data-collapsed="true"] .dsh-ent-resource-row {
      width: 36px;
      height: 36px;
      justify-content: center;
      padding: 0;
      border-inline: 0;
    }

    .dsh-ent-resource-rows,
    [data-dsh-enterprise-resources][data-collapsed="true"] .dsh-ent-resource-rows {
      display: flex;
      gap: 12px;
    }
  }

  [data-dsh-enterprise-quota] {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--dsw-radius-sm, 8px);
    background: transparent;
    color: var(--dsw-alias-label-primary, #17191d);
    font-family: inherit;
    font-size: 12px;
    line-height: 20px;
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color 120ms ease;
  }

  [data-dsh-enterprise-quota][hidden] {
    display: none !important;
  }

  @media (hover: hover) {
    [data-dsh-enterprise-quota]:hover {
      background: var(--dsw-alias-interactive-bg-hover, rgba(120, 125, 140, 0.1));
    }
  }

  [data-dsh-enterprise-quota]:focus-visible {
    outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #2563eb));
    outline-offset: -2px;
  }

  .dsh-ent-quota-plan,
  .dsh-ent-quota-mine,
  .dsh-ent-quota-percent,
  .dsh-ent-quota-amount small {
    color: var(--dsw-alias-label-tertiary, #7a7f89);
    font-size: 11px;
    font-weight: 400;
  }

  .dsh-ent-quota-percent {
    font-variant-numeric: tabular-nums;
  }

  .dsh-ent-quota-percent[data-tone="warning"] {
    color: var(--dsw-alias-state-warning-primary, #b7791f);
  }

  .dsh-ent-quota-percent[data-tone="danger"] {
    color: var(--dsw-alias-state-error-primary, #c93737);
  }

  .dsh-ent-quota-amount {
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  .dsh-ent-quota-amount strong {
    font-weight: 500;
  }

  .dsh-ent-quota-amount small {
    font-size: 10.5px;
  }

  .dsh-ent-quota-track {
    flex: none;
    width: 28px;
    height: 3px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--dsw-alias-bg-skeleton, rgba(0, 0, 0, 0.08));
  }

  .dsh-ent-quota-track > span {
    display: block;
    width: 0;
    height: 100%;
    border-radius: inherit;
    background: var(--dsw-alias-state-business-primary, #2563eb);
    transition: width 160ms ease;
  }

  .dsh-ent-quota-track > span[data-tone="warning"] {
    background: var(--dsw-alias-state-warning-primary, #b7791f);
  }

  .dsh-ent-quota-track > span[data-tone="danger"] {
    background: var(--dsw-alias-state-error-primary, #c93737);
  }

  .dsh-ent-quota-mine {
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 720px) {
    .dsh-ent-quota-plan,
    .dsh-ent-quota-mine,
    .dsh-ent-quota-track {
      display: none;
    }
  }

  [data-dsh-enterprise-settings-row] {
    position: relative !important;
  }

  html[data-dsh-enterprise] [data-dsh-enterprise-settings-row] > [data-slot="settings.launcher"] {
    visibility: hidden !important;
    pointer-events: none !important;
  }

  [data-dsh-enterprise-account] {
    position: absolute;
    z-index: 2;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    font-family: var(--dsw-font-family, system-ui, -apple-system, "Segoe UI", sans-serif);
  }

  [data-dsh-enterprise-account][hidden] {
    display: none !important;
  }

  .dsh-ent-account-trigger {
    display: flex;
    width: 100%;
    height: 44px;
    min-width: 0;
    align-items: center;
    gap: 8px;
    box-sizing: border-box;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--dsw-radius-md, 12px);
    background: transparent;
    color: var(--dsw-alias-label-primary, #17191d);
    cursor: pointer;
    text-align: left;
    transition: background 120ms ease;
  }

  @media (hover: hover) {
    .dsh-ent-account-trigger:hover {
      background: var(--dsw-alias-interactive-bg-hover, rgba(120, 125, 140, 0.1));
    }
  }

  .dsh-ent-avatar {
    display: grid;
    width: 24px;
    height: 24px;
    flex: none;
    place-items: center;
    border-radius: 50%;
    background: var(--dsw-alias-bg-skeleton, rgba(0, 0, 0, 0.04));
    color: var(--dsw-alias-label-tertiary, #81858c);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0;
    line-height: 1;
    text-transform: uppercase;
  }

  .dsh-ent-copy {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 0;
    line-height: 22px;
  }

  .dsh-ent-name {
    overflow: hidden;
    color: var(--dsw-alias-label-primary, #17191d);
    font-size: 14px;
    font-weight: 400;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dsh-ent-email {
    overflow: hidden;
    color: var(--dsw-alias-label-tertiary, #7a7f89);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dsh-ent-chevron {
    flex: none;
    margin-left: auto;
    color: var(--dsw-alias-label-tertiary, #7a7f89);
    transition: transform 120ms ease;
  }

  .dsh-ent-account-trigger[aria-expanded="true"] .dsh-ent-chevron {
    transform: translateY(1px);
  }

  [data-dsh-enterprise-account][data-collapsed="true"] .dsh-ent-account-trigger {
    width: 36px;
    height: 36px;
    margin: 0 auto;
    padding: 6px;
  }

  [data-dsh-enterprise-account][data-collapsed="true"] .dsh-ent-copy,
  [data-dsh-enterprise-account][data-collapsed="true"] .dsh-ent-chevron {
    display: none;
  }

  [data-dsh-enterprise-menu] {
    position: fixed;
    z-index: 1300;
    display: flex;
    width: 240px;
    max-width: calc(100vw - 24px);
    max-height: min(560px, calc(100vh - 24px));
    flex-direction: column;
    box-sizing: border-box;
    padding: 4px;
    overflow: auto;
    border: 0;
    border-radius: var(--dsw-radius-lg, 16px);
    background: var(--dsw-specific-menu, var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-3, #fff)));
    backdrop-filter: var(--dsw-menu-backdrop-filter, blur(20px) saturate(1.8));
    box-shadow: var(--dsw-elevation-prominent, 0 18px 48px rgba(15, 23, 42, 0.18));
    color: var(--dsw-alias-label-primary, #17191d);
    font-family: var(--dsw-font-family, system-ui, -apple-system, "Segoe UI", sans-serif);
    animation: dsh-ent-menu-in 120ms ease-out;
  }

  [data-dsh-enterprise-menu][hidden] {
    display: none !important;
  }

  @keyframes dsh-ent-menu-in {
    from { opacity: 0; transform: translateY(4px) scale(0.985); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .dsh-ent-menu-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 10px 10px;
  }

  .dsh-ent-menu-header .dsh-ent-avatar {
    width: 32px;
    height: 32px;
    font-size: 12px;
  }

  .dsh-ent-menu-header .dsh-ent-name {
    font-size: 13px;
  }

  .dsh-ent-menu-header .dsh-ent-email {
    font-size: 12px;
  }

  .dsh-ent-menu-body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 2px 0;
  }

  .dsh-ent-menu-item {
    display: flex;
    width: 100%;
    min-height: 36px;
    align-items: center;
    gap: 8px;
    box-sizing: border-box;
    padding: 4px 8px;
    border: 0;
    border-radius: var(--dsw-radius-sm, 8px);
    background: transparent;
    color: var(--dsw-alias-label-secondary, #545860);
    cursor: pointer;
    font: inherit;
    font-size: 13px;
    text-align: left;
    text-decoration: none;
    transition: background 120ms ease, color 120ms ease;
  }

  .dsh-ent-menu-item[hidden] {
    display: none !important;
  }

  .dsh-ent-menu-item:focus-visible {
    background: var(--dsw-alias-interactive-bg-hover, rgba(120, 125, 140, 0.1));
    color: var(--dsw-alias-label-primary, #17191d);
  }

  @media (hover: hover) {
    .dsh-ent-menu-item:hover {
      background: var(--dsw-alias-interactive-bg-hover, rgba(120, 125, 140, 0.1));
      color: var(--dsw-alias-label-primary, #17191d);
    }
  }

  .dsh-ent-menu-item:focus-visible {
    outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #2563eb));
    outline-offset: 1px;
  }

  .dsh-ent-menu-icon {
    display: inline-flex;
    width: 16px;
    height: 16px;
    flex: none;
    place-items: center;
    border-radius: 0;
    background: transparent;
    color: var(--dsw-alias-menu-icon, var(--dsw-alias-label-secondary, #61666b));
  }

  .dsh-ent-menu-icon svg {
    width: 16px;
    height: 16px;
  }

  .dsh-ent-menu-label {
    flex: 1;
  }

  .dsh-ent-menu-item[data-enterprise-action="signout"] {
    color: var(--dsw-alias-state-error-primary, #c93737);
  }

  .dsh-ent-menu-item[data-enterprise-action="signout"] .dsh-ent-menu-icon {
    color: var(--dsw-alias-state-error-primary, #c93737);
  }

  .dsh-ent-menu-separator {
    height: 0.5px;
    margin: 4px 8px;
    background: var(--dsw-alias-border-l1, rgba(15, 23, 42, 0.08));
  }

  .dsh-ent-brand-mark {
    display: block;
    flex: none;
    object-fit: contain;
  }

  @media (prefers-reduced-motion: reduce) {
    .dsh-ent-account-trigger,
    .dsh-ent-chevron,
    [data-dsh-enterprise-menu] {
      animation: none;
      transition: none;
    }
  }
`

/**
 * Replace the Harness account launcher with an enterprise account card that
 * exposes identity, administration, settings, and sign-out. The card
 * revalidates the enterprise session and returns to login as soon as the
 * session is revoked, including a stale back/forward cache entry.
 */
export function createHarnessSessionGuardScript(publicPathPrefix: string): string {
  return String.raw`(function () {
  'use strict'
  var PUBLIC_PATH_PREFIX = ${JSON.stringify(publicPathPrefix)}
  function enterprisePath(path) { return PUBLIC_PATH_PREFIX + path }
  document.documentElement.setAttribute('data-dsh-enterprise', '')
  window.__DSH_SIDEBAR_BROWSER_REMOTE__ = { endpoint: enterprisePath('/enterprise/api/browser') }
  var SESSION_URL = enterprisePath('/enterprise/api/session')
  var BILLING_URL = enterprisePath('/enterprise/api/billing')
  var LOGOUT_URL = enterprisePath('/enterprise/api/logout')
  var CHANNEL_NAME = 'enterprise-session' + PUBLIC_PATH_PREFIX
  var POLL_MILLISECONDS = 15000
  var RESOURCE_STORAGE_KEY = 'enterprise.resourcesCollapsed' + PUBLIC_PATH_PREFIX
  var RESOURCE_OPEN_EVENT = 'dsh-enterprise-resource-open'
  var RESOURCE_ACTIVE_EVENT = 'dsh-enterprise-resource-active'
  var BRAND_NAME = ${JSON.stringify(ENTERPRISE_BRAND_NAME)}
  var BUILD_BRAND_NAMES = ['DSH Local Build', 'DSH 本地构建']
  var ADMIN_PERMISSIONS = [
    'dashboard.read', 'users.read', 'teams.read', 'roles.read', 'plans.read',
    'orders.read', 'channels.read', 'models.read', 'usage.read', 'audit.read',
    'settings.read', 'plugins.builtin.write', 'plugins.enterprise.write'
  ]
  var redirecting = false
  var channel = null
  var session = null
  var billing = null
  var root = null
  var trigger = null
  var avatar = null
  var nameNode = null
  var menu = null
  var menuOpen = false
  var nativeTrigger = null
  var settingsRow = null
  var resources = null
  var quota = null
  var quotaPercent = null
  var quotaBar = null
  var quotaPlan = null
  var observer = null
  var titleObserver = null

  function redirectToLogin() {
    if (redirecting) return
    redirecting = true
    var params = new URLSearchParams(window.location.search)
    params.delete('token')
    var query = params.toString()
    var next = window.location.pathname + (query === '' ? '' : '?' + query)
    window.location.replace(enterprisePath('/enterprise/login?next=') + encodeURIComponent(next))
  }

  function signedOutMessage() {
    try {
      if (channel === null) return
      channel.postMessage({ type: 'signed-out' })
    } catch (_error) {}
  }

  function element(tag, text) {
    var node = document.createElement(tag)
    if (text !== undefined) node.textContent = text
    return node
  }

  function icon(markup) {
    var wrapper = element('span')
    wrapper.setAttribute('aria-hidden', 'true')
    wrapper.className = 'dsh-ent-menu-icon'
    wrapper.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + markup + '</svg>'
    return wrapper
  }

  function brandMark(size) {
    return '<img class="dsh-ent-brand-mark" width="' + size + '" height="' + size + '"'
      + ' alt="" aria-hidden="true" data-dsh-enterprise-brand-mark="true"'
      + ' src="' + enterprisePath('/enterprise/brand-mark.png') + '">'
  }

  function replaceBrandText(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    var node = walker.nextNode()
    while (node !== null) {
      if (node.nodeValue !== null) {
        for (var brandIndex = 0; brandIndex < BUILD_BRAND_NAMES.length; brandIndex++) {
          var buildBrandName = BUILD_BRAND_NAMES[brandIndex]
          if (node.nodeValue.indexOf(buildBrandName) !== -1) {
            node.nodeValue = node.nodeValue.split(buildBrandName).join(BRAND_NAME)
          }
        }
      }
      node = walker.nextNode()
    }
  }

  function applyBrand() {
    if (typeof document === 'undefined') return
    var slots = document.querySelectorAll('[data-slot="sidebar.brand.mark"], [data-slot="conversation.hero.brand.mark"]')
    for (var index = 0; index < slots.length; index++) {
      var slot = slots[index]
      if (slot.querySelector('[data-dsh-enterprise-brand-mark]') !== null) continue
      slot.innerHTML = brandMark(slot.getAttribute('data-slot') === 'conversation.hero.brand.mark' ? 30 : 24)
    }
    var names = document.querySelectorAll('[data-slot="sidebar.brand.name"]')
    for (var nameIndex = 0; nameIndex < names.length; nameIndex++) replaceBrandText(names[nameIndex])
    applyDocumentTitle()
    var favicon = document.querySelector('link[rel="icon"]')
    if (favicon === null && document.head !== null) {
      favicon = document.createElement('link')
      favicon.setAttribute('rel', 'icon')
      document.head.appendChild(favicon)
    }
    if (favicon !== null) favicon.setAttribute('href', enterprisePath('/enterprise/favicon.png'))
  }

  function applyDocumentTitle() {
    if (document.title === '') {
      document.title = BRAND_NAME
      return
    }
    for (var titleIndex = 0; titleIndex < BUILD_BRAND_NAMES.length; titleIndex++) {
      var titleBrandName = BUILD_BRAND_NAMES[titleIndex]
      if (document.title.indexOf(titleBrandName) !== -1) {
        document.title = document.title.split(titleBrandName).join(BRAND_NAME)
      }
    }
  }

  function resourceIcon(iconId) {
    var wrapper = element('span')
    wrapper.className = 'dsh-ent-resource-icon'
    wrapper.setAttribute('aria-hidden', 'true')
    wrapper.innerHTML = '<svg width="16" height="16" aria-hidden="true"><use href="#' + iconId + '"></use></svg>'
    return wrapper
  }

  function resourceRow(kind, label, iconId, destination) {
    var row = element(destination ? 'a' : 'button')
    if (destination) row.href = enterprisePath(destination)
    else row.type = 'button'
    row.className = 'dsh-ent-resource-row'
    row.setAttribute('data-enterprise-resource', kind)
    row.setAttribute('aria-label', label)
    row.addEventListener('click', function () {
      if (!destination) window.dispatchEvent(new CustomEvent(RESOURCE_OPEN_EVENT, { detail: kind }))
    })
    row.appendChild(resourceIcon(iconId))
    var text = element('span', label)
    text.className = 'dsh-ent-resource-label'
    row.appendChild(text)
    return row
  }

  function setResourcesCollapsed(collapsed) {
    if (resources === null) return
    resources.setAttribute('data-collapsed', collapsed ? 'true' : 'false')
    var toggle = resources.querySelector('.dsh-ent-resource-toggle')
    if (toggle !== null) toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
    try {
      window.localStorage.setItem(RESOURCE_STORAGE_KEY, collapsed ? 'true' : 'false')
    } catch (_error) {}
  }

  function createResources() {
    resources = element('nav')
    resources.id = 'dsh-enterprise-resources'
    resources.setAttribute('data-dsh-enterprise-resources', '')
    resources.setAttribute('aria-label', '资源')

    var toggle = element('button')
    toggle.type = 'button'
    toggle.className = 'dsh-ent-resource-toggle'
    toggle.setAttribute('aria-expanded', 'true')
    toggle.setAttribute('aria-controls', 'dsh-enterprise-resource-rows')
    var chevron = element('span')
    chevron.className = 'dsh-ent-resource-chevron'
    chevron.setAttribute('aria-hidden', 'true')
    chevron.innerHTML = '<svg width="12" height="12" aria-hidden="true"><use href="#dsw-icon-chevron-down-outline-regular"></use></svg>'
    toggle.appendChild(chevron)
    var title = element('span', '资源')
    toggle.appendChild(title)
    toggle.addEventListener('click', function () {
      setResourcesCollapsed(resources === null || resources.getAttribute('data-collapsed') !== 'true')
    })
    resources.appendChild(toggle)

    var rows = element('div')
    rows.id = 'dsh-enterprise-resource-rows'
    rows.className = 'dsh-ent-resource-rows'
    rows.appendChild(resourceRow('files', '文件', 'dsw-icon-deliver-doc-regular'))
    rows.appendChild(resourceRow('knowledge', '知识库', 'dsw-icon-database-outline-regular'))
    rows.appendChild(resourceRow('market', '智能体', 'dsw-icon-skill-outline-regular'))
    resources.appendChild(rows)

    var collapsed = false
    try {
      collapsed = window.localStorage.getItem(RESOURCE_STORAGE_KEY) === 'true'
    } catch (_error) {}
    setResourcesCollapsed(collapsed)
  }

  function ensureResources() {
    if (typeof document === 'undefined') return
    if (resources !== null && !resources.isConnected) resources = null
    if (resources !== null) return
    var panelSlot = document.querySelector('[data-slot="sidebar.panellist"]')
    var panelList = panelSlot === null ? null : panelSlot.closest('nav')
    if (panelList === null || panelList.parentElement === null) return
    createResources()
    panelList.appendChild(resources)
  }

  function setActiveResource(kind) {
    if (resources === null) return
    var rows = resources.querySelectorAll('[data-enterprise-resource]')
    for (var index = 0; index < rows.length; index += 1) {
      var row = rows[index]
      if (row.getAttribute('data-enterprise-resource') === kind) row.setAttribute('aria-current', 'page')
      else row.removeAttribute('aria-current')
    }
  }

  function createQuota() {
    quota = element('button')
    quota.type = 'button'
    quota.setAttribute('data-dsh-enterprise-quota', '')
    quota.setAttribute('aria-label', '查看套餐与积分')
    quota.setAttribute('aria-haspopup', 'dialog')
    quota.setAttribute('aria-expanded', 'false')
    quota.setAttribute('aria-controls', 'enterprise-usage-summary')
    quota.addEventListener('click', function () {
      window.dispatchEvent(new CustomEvent('dsh-enterprise-usage-open', { detail: quota }))
    })
    quota.hidden = true

    quotaPlan = element('span')
    quotaPlan.className = 'dsh-ent-quota-plan'

    var track = element('span')
    track.className = 'dsh-ent-quota-track'
    track.setAttribute('aria-hidden', 'true')
    quotaBar = element('span')
    track.appendChild(quotaBar)

    quotaPercent = element('span', '0%')
    quotaPercent.className = 'dsh-ent-quota-percent'

    quota.appendChild(quotaPlan)
    quota.appendChild(track)
    quota.appendChild(quotaPercent)
  }

  function ensureQuota() {
    if (typeof document === 'undefined') return
    if (quota !== null && !quota.isConnected) {
      quota = null
      quotaPercent = null
      quotaBar = null
      quotaPlan = null
    }
    var slot = document.querySelector('[data-slot="conversation.hero.options"]')
      || document.querySelector('[data-slot="conversation.session.header.utilities"]')
    var host = slot === null ? null : slot.parentElement
    if (host === null) return
    if (quota !== null) {
      if (quota.parentElement !== host) host.appendChild(quota)
      return
    }
    createQuota()
    host.appendChild(quota)
    paintBilling()
  }

  function paintBilling() {
    if (quota === null || quotaPercent === null || quotaBar === null) return
    var value = billing !== null && typeof billing === 'object' ? billing.quota : null
    if (value === null || typeof value !== 'object') return
    var percent = typeof value.percentUsed === 'number' ? Math.max(0, Math.min(100, value.percentUsed)) : 0
    var plan = billing.plan !== null && typeof billing.plan === 'object' && typeof billing.plan.name === 'string'
      ? billing.plan.name : '未分配套餐'
    quota.hidden = false
    quotaPercent.textContent = '已用 ' + Math.round(percent) + '%'
    quotaPercent.setAttribute('data-tone', percent >= 90 ? 'danger' : percent >= 70 ? 'warning' : 'normal')
    quotaBar.style.width = percent + '%'
    quotaBar.setAttribute('data-tone', percent >= 90 ? 'danger' : percent >= 70 ? 'warning' : 'normal')
    quotaPlan.textContent = plan
    quota.title = '本月套餐使用进度 ' + Math.round(percent) + '%'
    quota.setAttribute('aria-label', plan + '，本月已用 ' + Math.round(percent) + '%，查看套餐与积分')
  }

  function chevron(up) {
    var wrapper = element('span')
    wrapper.setAttribute('aria-hidden', 'true')
    wrapper.className = 'dsh-ent-chevron'
    wrapper.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + (up ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6') + '"/></svg>'
    return wrapper
  }

  function initials(value) {
    var source = typeof value === 'string' ? value.trim() : ''
    if (source === '') return '企'
    var parts = source.split(/\s+/)
    if (parts.length > 1) return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
    var characters = Array.from(source)
    return /^[A-Za-z]/u.test(source) ? characters.slice(0, 2).join('').toUpperCase() : characters[0].toUpperCase()
  }

  function avatarNode(size) {
    var node = element('span')
    node.className = 'dsh-ent-avatar'
    if (size !== undefined) {
      node.style.width = size + 'px'
      node.style.height = size + 'px'
      node.style.fontSize = Math.max(10, Math.round(size * 0.3)) + 'px'
    }
    node.setAttribute('aria-hidden', 'true')
    return node
  }

  function paintAvatar(node, user) {
    var label = user !== null && typeof user === 'object' && typeof user.name === 'string' && user.name.trim() !== ''
      ? user.name
      : user !== null && typeof user === 'object' && typeof user.email === 'string' ? user.email : '企业'
    node.textContent = initials(label)
  }

  function canUseAdmin(candidate) {
    var permissions = candidate !== null && typeof candidate === 'object' && Array.isArray(candidate.permissions)
      ? candidate.permissions : []
    return ADMIN_PERMISSIONS.some(function (permission) { return permissions.indexOf(permission) !== -1 })
  }

  function menuItem(action, label, iconMarkup) {
    var item = element('button')
    item.type = 'button'
    item.setAttribute('role', 'menuitem')
    item.setAttribute('data-enterprise-action', action)
    item.className = 'dsh-ent-menu-item'
    item.appendChild(icon(iconMarkup))
    var labelNode = element('span', label)
    labelNode.className = 'dsh-ent-menu-label'
    item.appendChild(labelNode)
    return item
  }

  function createMenu() {
    var surface = element('div')
    surface.setAttribute('data-dsh-enterprise-menu', '')
    surface.setAttribute('role', 'menu')
    surface.setAttribute('aria-label', '企业账户菜单')
    surface.hidden = true

    var header = element('div')
    header.className = 'dsh-ent-menu-header'
    var headerAvatar = avatarNode(32)
    var headerCopy = element('div')
    headerCopy.className = 'dsh-ent-copy'
    var headerName = element('span')
    headerName.className = 'dsh-ent-name'
    var headerEmail = element('span')
    headerEmail.className = 'dsh-ent-email'
    headerCopy.appendChild(headerName)
    headerCopy.appendChild(headerEmail)
    header.appendChild(headerAvatar)
    header.appendChild(headerCopy)
    surface.appendChild(header)

    var body = element('div')
    body.className = 'dsh-ent-menu-body'

    var billingItem = element('button')
    billingItem.type = 'button'
    billingItem.setAttribute('role', 'menuitem')
    billingItem.setAttribute('data-enterprise-action', 'billing')
    billingItem.className = 'dsh-ent-menu-item'
    billingItem.appendChild(icon('<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19"/>'))
    var billingLabel = element('span', '套餐与积分')
    billingLabel.className = 'dsh-ent-menu-label'
    billingItem.appendChild(billingLabel)
    body.appendChild(billingItem)

    var adminItem = element('a')
    adminItem.href = enterprisePath('/enterprise/admin')
    adminItem.setAttribute('role', 'menuitem')
    adminItem.setAttribute('data-enterprise-action', 'admin')
    adminItem.className = 'dsh-ent-menu-item'
    adminItem.appendChild(icon('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 14h3M8 17h6"/>'))
    var adminLabel = element('span', '管理控制台')
    adminLabel.className = 'dsh-ent-menu-label'
    adminItem.appendChild(adminLabel)
    body.appendChild(adminItem)

    var passwordItem = element('a')
    passwordItem.href = enterprisePath('/enterprise/account')
    passwordItem.setAttribute('role', 'menuitem')
    passwordItem.setAttribute('data-enterprise-action', 'password')
    passwordItem.className = 'dsh-ent-menu-item'
    passwordItem.appendChild(icon('<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'))
    var passwordLabel = element('span', '修改密码')
    passwordLabel.className = 'dsh-ent-menu-label'
    passwordItem.appendChild(passwordLabel)
    body.appendChild(passwordItem)

    var settingsItem = menuItem('settings', '工作台设置', '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>')
    body.appendChild(settingsItem)

    var separator = element('div')
    separator.className = 'dsh-ent-menu-separator'
    separator.setAttribute('role', 'separator')
    body.appendChild(separator)

    var signOutItem = menuItem('signout', '退出登录', '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>')
    body.appendChild(signOutItem)
    surface.appendChild(body)

    billingItem.addEventListener('click', function () {
      closeMenu(false)
      window.dispatchEvent(new CustomEvent('dsh-enterprise-usage-open', { detail: quota !== null && quota.isConnected ? quota : trigger }))
    })
    adminItem.addEventListener('click', function () { closeMenu(false) })
    passwordItem.addEventListener('click', function () { closeMenu(false) })
    settingsItem.addEventListener('click', function () {
      closeMenu(false)
      openHarnessSettings()
    })
    signOutItem.addEventListener('click', function () { signOut() })
    surface.addEventListener('keydown', onMenuKeyDown)
    document.body.appendChild(surface)
    return surface
  }

  function createAccount() {
    var launcher = document.querySelector('[data-slot="settings.launcher"]')
    if (launcher === null || launcher.parentElement === null) return
    nativeTrigger = launcher.querySelector('button[aria-haspopup="menu"]')
    if (nativeTrigger === null) return
    settingsRow = launcher.parentElement
    settingsRow.setAttribute('data-dsh-enterprise-settings-row', '')

    root = element('div')
    root.setAttribute('data-dsh-enterprise-account', '')
    root.hidden = true

    trigger = element('button')
    trigger.type = 'button'
    trigger.className = 'dsh-ent-account-trigger'
    trigger.setAttribute('aria-haspopup', 'menu')
    trigger.setAttribute('aria-expanded', 'false')
    trigger.setAttribute('aria-label', '企业账户')
    avatar = avatarNode()
    var copy = element('span')
    copy.className = 'dsh-ent-copy'
    nameNode = element('span')
    nameNode.className = 'dsh-ent-name'
    copy.appendChild(nameNode)
    trigger.appendChild(avatar)
    trigger.appendChild(copy)
    trigger.appendChild(chevron(true))
    trigger.addEventListener('click', function () {
      if (menuOpen) closeMenu(true)
      else openMenu()
    })
    root.appendChild(trigger)
    settingsRow.appendChild(root)
    syncCollapsedState()
    menu = createMenu()
    if (session !== null) paintSession(session)
  }

  function ensureAccount() {
    if (root !== null && !root.isConnected) {
      root = null
      trigger = null
      avatar = null
      menu = null
    }
    if (root !== null) {
      syncCollapsedState()
      return
    }
    if (document.body === null) return
    createAccount()
  }

  function syncCollapsedState() {
    if (root === null || nativeTrigger === null) return
    var collapsed = nativeTrigger.getAttribute('data-collapsed') === 'true' ? 'true' : 'false'
    if (root.getAttribute('data-collapsed') !== collapsed) root.setAttribute('data-collapsed', collapsed)
  }

  function paintSession(candidate) {
    if (root === null || trigger === null || avatar === null || menu === null) return
    var user = candidate !== null && typeof candidate === 'object' && candidate.user !== null && typeof candidate.user === 'object'
      ? candidate.user : {}
    var name = typeof user.name === 'string' && user.name.trim() !== '' ? user.name : '企业成员'
    var email = typeof user.email === 'string' ? user.email : ''
    paintAvatar(avatar, user)
    paintAvatar(menu.querySelector('.dsh-ent-menu-header .dsh-ent-avatar'), user)
    nameNode.textContent = name
    trigger.setAttribute('aria-label', '企业账户：' + name + (email === '' ? '' : '，' + email))
    var header = menu.querySelector('.dsh-ent-menu-header')
    header.querySelector('.dsh-ent-name').textContent = name
    header.querySelector('.dsh-ent-email').textContent = email
    menu.querySelector('[data-enterprise-action="admin"]').hidden = !canUseAdmin(candidate)
    root.hidden = false
  }

  function showSession(candidate) {
    session = candidate
    ensureAccount()
    if (root !== null) paintSession(candidate)
  }

  function menuItems() {
    if (menu === null) return []
    return Array.prototype.slice.call(menu.querySelectorAll('[role="menuitem"]')).filter(function (item) {
      return !item.hidden
    })
  }

  function placeMenu() {
    if (menu === null || trigger === null) return
    var rect = trigger.getBoundingClientRect()
    var width = menu.offsetWidth
    var height = menu.offsetHeight
    var margin = 12
    var gap = 8
    var left = Math.min(Math.max(rect.left, margin), Math.max(margin, window.innerWidth - width - margin))
    var top = rect.top - height - gap
    if (top < margin) top = Math.min(rect.bottom + gap, window.innerHeight - height - margin)
    menu.style.left = Math.round(left) + 'px'
    menu.style.top = Math.round(Math.max(margin, top)) + 'px'
  }

  function onDocumentPointerDown(event) {
    if (menu === null || trigger === null) return
    if (event.target instanceof Node && (menu.contains(event.target) || trigger.contains(event.target))) return
    closeMenu(false)
  }

  function onDocumentKeyDown(event) {
    if (event.key === 'Escape' && menuOpen) {
      event.preventDefault()
      closeMenu(true)
    }
  }

  function onMenuKeyDown(event) {
    var items = menuItems()
    if (items.length === 0) return
    var index = items.indexOf(document.activeElement)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      var next = event.key === 'ArrowDown' ? index + 1 : index - 1
      if (next < 0) next = items.length - 1
      if (next >= items.length) next = 0
      items[next].focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      items[0].focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      items[items.length - 1].focus()
    } else if (event.key === 'Tab') {
      closeMenu(false)
    }
  }

  function openMenu() {
    if (menu === null || trigger === null) return
    menuOpen = true
    trigger.setAttribute('aria-expanded', 'true')
    menu.hidden = false
    menu.style.visibility = 'hidden'
    placeMenu()
    menu.style.visibility = 'visible'
    document.addEventListener('pointerdown', onDocumentPointerDown, true)
    document.addEventListener('keydown', onDocumentKeyDown, true)
    window.addEventListener('resize', placeMenu)
    window.addEventListener('scroll', placeMenu, true)
    var items = menuItems()
    if (items.length > 0) items[0].focus()
  }

  function closeMenu(returnFocus) {
    if (!menuOpen) return
    menuOpen = false
    if (menu !== null) menu.hidden = true
    if (trigger !== null) trigger.setAttribute('aria-expanded', 'false')
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
    document.removeEventListener('keydown', onDocumentKeyDown, true)
    window.removeEventListener('resize', placeMenu)
    window.removeEventListener('scroll', placeMenu, true)
    if (returnFocus && trigger !== null) trigger.focus()
  }

  function openHarnessSettings() {
    if (nativeTrigger === null) return
    nativeTrigger.click()
    var attempts = 0
    function selectSettings() {
      var item = document.querySelector('[data-menu-id="settings"]')
        || document.querySelector('[role="menu"]:not([data-dsh-enterprise-menu]) [role="menuitem"]')
      if (item !== null && !item.hidden) {
        item.click()
        return
      }
      attempts += 1
      if (attempts < 30) window.setTimeout(selectSettings, 16)
    }
    window.setTimeout(selectSettings, 0)
  }

  function loadBilling() {
    return fetch(BILLING_URL, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    }).then(function (response) {
      if (response.status === 401) {
        redirectToLogin()
        return null
      }
      if (!response.ok) return null
      return response.json().then(function (candidate) {
        billing = candidate
        paintBilling()
        return candidate
      })
    }).catch(function () {
      return null
    })
  }

  function signOut() {
    closeMenu(false)
    var item = menu === null ? null : menu.querySelector('[data-enterprise-action="signout"]')
    if (item !== null) {
      item.disabled = true
      item.querySelector('.dsh-ent-menu-label').textContent = '正在退出…'
    }
    fetch(LOGOUT_URL, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).catch(function () {
      return null
    }).then(function () {
      signedOutMessage()
      redirectToLogin()
    })
  }

  function mount() {
    if (document.body === null) return
    if (document.getElementById('dsh-enterprise-session-styles') === null && document.head !== null) {
      var style = element('style', ${JSON.stringify(SESSION_GUARD_STYLES)})
      style.id = 'dsh-enterprise-session-styles'
      document.head.appendChild(style)
    }
    applyBrand()
    ensureResources()
    ensureQuota()
    ensureAccount()
    if (observer === null) {
      observer = new MutationObserver(function () {
        if (typeof document === 'undefined') {
          observer.disconnect()
          observer = null
          return
        }
        applyBrand()
        ensureResources()
        ensureQuota()
        ensureAccount()
        syncCollapsedState()
      })
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-collapsed'],
      })
    }
    if (titleObserver === null && document.head !== null) {
      titleObserver = new MutationObserver(applyDocumentTitle)
      titleObserver.observe(document.head, {
        childList: true,
        subtree: true,
        characterData: true,
      })
    }
  }

  function check() {
    return fetch(SESSION_URL, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    }).then(function (response) {
      if (response.status === 401) {
        redirectToLogin()
        return null
      }
      if (!response.ok) return null
      return response.json().then(function (candidate) {
        showSession(candidate)
        void loadBilling()
        return candidate
      })
    }).catch(function () {
      return null
    })
  }

  try {
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.addEventListener('message', function (event) {
      if (event.data !== null && typeof event.data === 'object' && event.data.type === 'signed-out') {
        redirectToLogin()
      }
    })
  } catch (_error) {
    channel = null
  }

  mount()
  void check()
  window.addEventListener(RESOURCE_ACTIVE_EVENT, function (event) {
    setActiveResource(event.detail === 'files' || event.detail === 'knowledge' || event.detail === 'skills' ? event.detail : null)
  })
  window.setInterval(function () {
    if (!document.hidden) void check()
  }, POLL_MILLISECONDS)
  window.addEventListener('focus', function () { void check() })
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) void check()
  })
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) void check()
  })
  window.addEventListener('pagehide', function () {
    if (observer !== null) observer.disconnect()
    if (channel !== null) channel.close()
  })
})()
`
}

/** Origin-root guard retained for deployments without a public path prefix. */
export const HARNESS_SESSION_GUARD_SCRIPT = createHarnessSessionGuardScript('')
