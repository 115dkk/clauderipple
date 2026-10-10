// The settings panel, drawn in the band: a header with the name and one tab per card, the
// open card, and a footer with Save / Close. Every change goes to a draft; Save keeps it, Close
// drops it. One card at a time keeps the panel inside the band's rows at any terminal size.

import { t } from '../i18n'
import type { RenderNode } from 'claude-code'

import type { Calibration, Domain, Effort, Rule, Settings, WorkerSection } from '../../types'
import { DEFAULTS, DOMAINS, LEVELS } from '../settings'
import { action, chip, segmented, toggle } from './parts'
import type { Els } from './parts'
import { svgDoc, textTone, v } from './theme'
import type { Frame, SettingsActions, SettingsTab, SettingsView } from './view'
import { EFFORTS, effortName, isRich, targetOf, targetValue } from './view'

export const TABS: readonly { value: SettingsTab; label: string; hotkey: string; blurb: string }[] = [
  { value: 'effort', label: 'band.effort', hotkey: 'e', blurb: 'settings.effortBlurb' },
  { value: 'workers', label: 'settings.workers', hotkey: 'w', blurb: 'settings.workersBlurb' },
  { value: 'judge', label: 'settings.judge', hotkey: 'j', blurb: 'workers.judgeBlurb' },
  { value: 'cache', label: 'band.cache', hotkey: 'c', blurb: 'settings.cacheBlurb' },
  { value: 'handoff', label: 'settings.handoff', hotkey: 'h', blurb: 'settings.handoffBlurb' },
  { value: 'look', label: 'settings.look', hotkey: 'l', blurb: 'settings.lookBlurb' },
]

const LABEL_W = 15

/** A labelled row: label column, the control, an optional quiet hint. */
export function row(el: Els, key: string, label: string, control: RenderNode, hint?: string): RenderNode {
  const { Box, Text } = el
  return (
    <Box key={'row-' + key} flexDirection="row" alignItems="center" columnGap={1} flexWrap="wrap">
      <Box width={LABEL_W} flexShrink={0}>
        <Text dimColor>{label}</Text>
      </Box>
      {control}
      {hint ? <Text dimColor>{hint}</Text> : null}
    </Box>
  )
}

/** A Select, or on a surface without one (mobile) the value as text. */
export function picker(el: Els, key: string, options: readonly { value: string; label?: string }[], value: string, onSelect: (value: string) => void): RenderNode {
  if (!('Select' in el)) {
    const { Text } = el
    return <Text>{options.find(o => o.value === value)?.label ?? value}</Text>
  }
  const { Select } = el
  const list = options.some(o => o.value === value) ? options : [{ value, label: value }, ...options]
  return <Select key={key} options={list} value={value} onSelect={(picked: string) => onSelect(picked)} />
}

// ---- The bias slider ---------------------------------------------------------------------------

const BIAS: readonly Settings['bias'][] = [-2, -1, 0, 1, 2]

function biasSlider(el: Els, frame: Frame, bias: Settings['bias'], onPick: (bias: Settings['bias']) => void): RenderNode {
  const { Box, Text } = el
  if (!isRich(frame) || !('Svg' in el)) {
    return segmented(
      el,
      frame,
      'bias',
      BIAS.map(b => ({ value: String(b), label: b > 0 ? '+' + b : b < 0 ? '−' + -b : '0' })),
      String(bias),
      picked => onPick(Number(picked) as Settings['bias']),
    )
  }
  // Five adjacent stops, each its own pressable picture of its stretch of the track.
  const w = 34
  const ht = 24
  const stops = BIAS.map((b, i) => {
    const on = b === bias
    const passed = (b <= bias && b >= 0 && bias > 0) || (b >= bias && b <= 0 && bias < 0)
    const y = ht / 2
    const left = i === 0 ? w / 2 : 0
    const right = i === BIAS.length - 1 ? w / 2 : w
    let body = '<line x1="' + left + '" y1="' + y + '" x2="' + right + '" y2="' + y + '" stroke="' + v('faint') + '" stroke-width="2"/>'
    if (passed && b !== 0) {
      const toward = b > 0 ? 0 : w
      body += '<line x1="' + toward + '" y1="' + y + '" x2="' + w / 2 + '" y2="' + y + '" stroke="' + v('accent') + '" stroke-width="2"/>'
    }
    if (passed && b === 0 && bias !== 0) {
      body += '<line x1="' + w / 2 + '" y1="' + y + '" x2="' + (bias > 0 ? w : 0) + '" y2="' + y + '" stroke="' + v('accent') + '" stroke-width="2"/>'
    }
    body += on
      ? '<circle cx="' + w / 2 + '" cy="' + y + '" r="7" fill="' + v('primary') + '"/><circle cx="' + w / 2 + '" cy="' + y + '" r="2.6" fill="#fff"/>'
      : '<circle cx="' + w / 2 + '" cy="' + y + '" r="' + (b === 0 ? 3.6 : 3) + '" fill="' + (passed ? v('accent') : v('faint')) + '"/>'
    return chip(el, {
      key: 'bias-' + b,
      source: svgDoc(w, ht, frame.appearance, body),
      alt: t(frame.lang, 'settings.biasAlt', { value: b > 0 ? '+' + b : String(b), selected: on ? t(frame.lang, 'settings.selected') : '' }),
      width: w,
      height: ht,
      onPress: () => onPick(b),
    })
  })
  return (
    <Box flexDirection="row" alignItems="center" columnGap={1}>
      <Text dimColor>{t(frame.lang, 'settings.cheaper')}</Text>
      <Box flexDirection="row">{stops}</Box>
      <Text dimColor>{t(frame.lang, 'settings.smarter')}</Text>
    </Box>
  )
}

// ---- Cards -------------------------------------------------------------------------------------


export function effortCard(el: Els, frame: Frame, d: Settings, a: SettingsActions): RenderNode[] {
  const effortOptions = EFFORTS.map(e => ({ value: e, label: effortName(e, frame.lang) }))
  return [
    row(el, 'auto', t(frame.lang, 'band.auto'), toggle(el, frame, 'set-auto', d.effortAuto ? t(frame.lang, 'band.on') : t(frame.lang, 'band.off'), d.effortAuto, () => a.patch({ effortAuto: !d.effortAuto })), t(frame.lang, 'settings.autoHint')),
    row(el, 'bias', t(frame.lang, 'settings.lean'), biasSlider(el, frame, d.bias, bias => a.patch({ bias })), t(frame.lang, 'settings.leanHint')),
    row(el, 'floor', t(frame.lang, 'settings.floor'), picker(el, 'floor', effortOptions, d.floor, floor => a.patch({ floor: floor as Effort }))),
    row(el, 'ceiling', t(frame.lang, 'settings.ceiling'), picker(el, 'ceiling', effortOptions, d.ceiling, ceiling => a.patch({ ceiling: ceiling as Effort })), EFFORTS.indexOf(d.ceiling) < EFFORTS.indexOf(d.floor) ? t(frame.lang, 'settings.floorWins') : undefined),
  ]
}

export function workersCard(el: Els, frame: Frame, view: SettingsView, a: SettingsActions): RenderNode[] {
  const { Box, Text } = el
  const d = view.draft
  const section = view.workerUi.section
  const label = (key: string) => t(frame.lang, 'workers.' + key)
  const providers = [...new Set([...view.routerModels.map(m => m.provider), 'anthropic', ...Object.keys(d.providers)])]
  const options = [{ value: '', label: label('noTarget') }, ...view.agents.map(o => ({ value: o.value, label: o.label + (o.available ? '' : t(frame.lang, 'settings.unavailable')) }))]
  const out: RenderNode[] = [
    row(el, 'agent-auto', t(frame.lang, 'settings.takesOver'), segmented(el, frame, 'agent-auto', [{ value: 'off', label: t(frame.lang, 'band.off') }, { value: 'auto', label: t(frame.lang, 'settings.autoAgent') }, { value: 'all', label: t(frame.lang, 'settings.allSpawns') }] as const, d.agentAuto, agentAuto => a.patch({ agentAuto }))),
    row(el, 'worker-section', label('domain'), picker(el, 'worker-section', ['providers', 'preference', ...DOMAINS].map(value => ({ value, label: label(value) })), section, value => a.setWorkerUi({ section: value as WorkerSection, page: 0 }))),
  ]
  const size = Math.max(1, Math.min(4, frame.maxRows - 7))
  const paged = (items: readonly string[], draw: (item: string, index: number) => RenderNode): void => {
    const pages = Math.max(1, Math.ceil(items.length / size))
    const page = Math.min(pages - 1, view.workerUi.page)
    out.push(...items.slice(page * size, (page + 1) * size).map((item, index) => draw(item, page * size + index)))
    if (pages > 1) out.push(<Box key="worker-pages" flexDirection="row" columnGap={1}>{action(el, frame, 'worker-previous', label('previous'), () => a.setWorkerUi({ page: Math.max(0, page - 1) }))}<Text dimColor>{t(frame.lang, 'workers.page', { page: page + 1, pages })}</Text>{action(el, frame, 'worker-next', label('next'), () => a.setWorkerUi({ page: Math.min(pages - 1, page + 1) }))}</Box>)
  }
  if (section === 'providers') {
    paged(providers, provider => row(el, 'provider-' + provider, provider, toggle(el, frame, 'provider-' + provider, d.providers[provider] === false ? t(frame.lang, 'band.off') : t(frame.lang, 'band.on'), d.providers[provider] !== false, () => a.patch({ providers: { ...d.providers, [provider]: d.providers[provider] === false } }))))
    out.push(row(el, 'fallback', t(frame.lang, 'settings.fallback'), picker(el, 'fallback', options.filter(o => o.value), targetValue(d.fallback), value => a.setFallback(targetOf(value))), label('fallbackHint')))
    return out
  }
  if (section === 'preference') {
    const move = (index: number, delta: number): void => { const order = [...d.preference]; const other = index + delta; if (other < 0 || other >= order.length) return; [order[index], order[other]] = [order[other]!, order[index]!]; a.patch({ preference: order }) }
    paged(d.preference, (item, index) => row(el, 'preference-' + index, item, <Box flexDirection="row" columnGap={1}>{action(el, frame, 'preference-up-' + index, label('up'), () => move(index, -1))}{action(el, frame, 'preference-down-' + index, label('down'), () => move(index, 1))}{action(el, frame, 'preference-remove-' + index, label('remove'), () => a.patch({ preference: d.preference.filter((_, i) => i !== index) }))}</Box>))
    const names = [...new Set([...providers, ...view.routerModels.map(m => m.value)])].filter(name => !d.preference.includes(name))
    out.push(row(el, 'preference-add', label('preference'), picker(el, 'preference-add', [{ value: '', label: label('addPreference') }, ...names.map(value => ({ value }))], '', value => { if (value) a.patch({ preference: [...d.preference, value] }) })))
    out.push(<Text key="preference-hint" dimColor>{label('preferenceHint')}</Text>)
    return out
  }
  const domain: Domain = section
  const rule = d.rules[domain]
  const modes: { value: Rule['mode']; label: string }[] = [{ value: 'pin', label: label('pin') }, { value: 'auto', label: label('auto') }, ...(domain === 'general' ? [] : [{ value: 'inherit' as const, label: label('inherit') }])]
  out.push(row(el, 'rule-mode', label('mode'), segmented(el, frame, 'rule-mode', modes, rule.mode, mode => { a.setWorkerUi({ page: 0 }); a.setRule(domain, mode === 'inherit' ? { mode } : mode === 'auto' ? { mode, allow: [] } : DEFAULTS.rules[domain].mode === 'pin' ? DEFAULTS.rules[domain] : { mode, targets: {} }) })))
  if (rule.mode === 'inherit') return out
  const calibrate = (change: Calibration): void => a.setRule(domain, { ...rule, ...change })
  if (rule.mode === 'pin') {
    for (const level of LEVELS) out.push(row(el, 'pin-' + level, t(frame.lang, 'settings.' + level), picker(el, 'pin-' + level, options, rule.targets[level] ? targetValue(rule.targets[level]!) : '', value => { const targets = { ...rule.targets }; if (value) targets[level] = targetOf(value); else delete targets[level]; a.setRule(domain, { ...rule, targets }) })))
  } else {
    for (const provider of providers) out.push(row(el, 'allow-' + provider, provider, toggle(el, frame, 'allow-' + provider, label('allow'), rule.allow.includes(provider), () => a.setRule(domain, { ...rule, allow: rule.allow.includes(provider) ? rule.allow.filter(p => p !== provider) : [...rule.allow, provider] }))))
    out.push(<Text key="allow-hint" dimColor>{label('allEnabled')}</Text>)
    for (const level of LEVELS) out.push(row(el, 'index-' + level, t(frame.lang, 'workers.indexFloor', { level: t(frame.lang, 'settings.' + level) }), picker(el, 'index-' + level, [...new Set([30, 45, 50, 53, d.autoFloors[level]])].map(n => ({ value: String(n) })), String(d.autoFloors[level]), value => a.patch({ autoFloors: { ...d.autoFloors, [level]: Number(value) } }))))
    out.push(row(el, 'tie-band', label('tieBand'), picker(el, 'tie-band', [...new Set([0, 1, 2, 3, 5, d.autoTieBand])].map(n => ({ value: String(n) })), String(d.autoTieBand), value => a.patch({ autoTieBand: Number(value) }))))
  }
  const effortOptions = [{ value: '', label: label('anyEffort') }, ...EFFORTS.map(value => ({ value, label: effortName(value, frame.lang) }))]
  out.push(row(el, 'offset', label('offset'), picker(el, 'rule-offset', [-2, -1, 0, 1, 2].map(n => ({ value: String(n) })), String(rule.effortOffset ?? 0), value => calibrate({ effortOffset: Number(value) as Calibration['effortOffset'] }))))
  out.push(row(el, 'rule-floor', t(frame.lang, 'settings.floor'), picker(el, 'rule-floor', effortOptions, rule.floor ?? '', value => calibrate({ floor: value ? value as Effort : undefined }))))
  out.push(row(el, 'rule-ceiling', t(frame.lang, 'settings.ceiling'), picker(el, 'rule-ceiling', effortOptions, rule.ceiling ?? '', value => calibrate({ ceiling: value ? value as Effort : undefined }))))
  const controls = out.slice(3)
  const capacity = Math.max(1, frame.maxRows - (rule.mode === 'auto' ? 9 : 8))
  const pages = Math.max(1, Math.ceil(controls.length / capacity))
  const page = Math.min(pages - 1, view.workerUi.page)
  const visible = [...out.slice(0, 3), ...controls.slice(page * capacity, (page + 1) * capacity)]
  if (rule.mode === 'auto') visible.push(<Text key="aa-line" dimColor>{t(frame.lang, 'workers.autoLine', { floor: d.autoFloors.standard })}</Text>)
  if (pages > 1) visible.push(<Box key="worker-pages" flexDirection="row" columnGap={1}>{action(el, frame, 'worker-previous', label('previous'), () => a.setWorkerUi({ page: Math.max(0, page - 1) }))}<Text dimColor>{t(frame.lang, 'workers.page', { page: page + 1, pages })}</Text>{action(el, frame, 'worker-next', label('next'), () => a.setWorkerUi({ page: Math.min(pages - 1, page + 1) }))}</Box>)
  return visible
}

export function judgeCard(el: Els, frame: Frame, view: SettingsView, a: SettingsActions): RenderNode[] {
  const d = view.draft
  const tone = textTone(frame.appearance)
  const { Box, Text } = el
  const out: RenderNode[] = [
    row(
      el,
      'judge',
      t(frame.lang, 'settings.judge'),
      segmented(
        el,
        frame,
        'judge',
        [
          { value: 'haiku', label: t(frame.lang, 'settings.haiku') },
          { value: 'jev', label: t(frame.lang, 'settings.jev') },
          { value: 'model', label: t(frame.lang, 'settings.routerModel') },
        ] as const,
        d.judge,
        judge => a.patch({ judge }),
      ),
    ),
  ]
  if (d.judge === 'haiku') out.push(row(el, 'haiku', '', <Text dimColor>{t(frame.lang, 'settings.haikuHint')}</Text>))
  if (d.judge === 'jev') {
    out.push(row(el, 'jev-source', t(frame.lang, 'jev.source'), segmented(el, frame, 'jev-source', [{ value: 'typesafe', label: t(frame.lang, 'jev.typesafe') }, { value: 'zen', label: t(frame.lang, 'jev.zen') }] as const, d.jevSource, jevSource => a.patch({ jevSource }))))
    const jev = view.jev
    const placeholder =
      jev.source === 'env' ? t(frame.lang, 'settings.keyEnv') : jev.source === 'file' ? t(frame.lang, 'settings.keyFile') : jev.source === 'pasted' ? t(frame.lang, 'settings.keySaved') : t(frame.lang, 'settings.keyPaste')
    const field =
      d.jevSource === 'zen' ? <Text dimColor>{t(frame.lang, jev.source === 'zen' ? 'jev.zenKey' : 'jev.zenMissing')}</Text> : 'Input' in el ? (
        <el.Input key="jev-key" placeholder={placeholder} value="" submitLabel={t(frame.lang, 'settings.saveKey')} onSubmit={(key: string) => a.jevKey(key)} />
      ) : (
        <Text dimColor>{placeholder}</Text>
      )
    const result =
      jev.test.state === 'testing' ? (
        <Text dimColor>{t(frame.lang, 'settings.testing')}</Text>
      ) : jev.test.state === 'ok' ? (
        <Text color={tone.ok}>{'✓ ' + (jev.test.message ?? t(frame.lang, 'settings.keyWorks'))}</Text>
      ) : jev.test.state === 'fail' ? (
        <Text color={tone.bad}>{'✕ ' + (jev.test.message ?? t(frame.lang, 'settings.keyRejected'))}</Text>
      ) : null
    out.push(
      row(
        el,
        'jev-key',
        t(frame.lang, 'settings.key'),
        <Box flexDirection="row" alignItems="center" columnGap={1}>
          {field}
          {action(el, frame, 'jev-test', t(frame.lang, 'settings.test'), a.testJev, { hotkey: 't' })}
          {result}
        </Box>,
      ),
    )
    out.push(row(el, 'jev-note', '', <Text color={tone.warn}>{t(frame.lang, d.jevSource === 'zen' ? 'jev.zenWarning' : 'settings.jevWarning')}</Text>))
  }
  if (d.judge === 'model') {
    const models = view.routerModels.map(m => ({ value: m.value, label: m.label }))
    out.push(row(el, 'judge-model', t(frame.lang, 'band.model'), models.length ? picker(el, 'judge-model', models, d.judgeModel, judgeModel => a.patch({ judgeModel })) : <Text dimColor>{t(frame.lang, 'settings.noModels')}</Text>, t(frame.lang, 'settings.haikuFallback')))
  }
  return out
}

export function cacheCard(el: Els, frame: Frame, d: Settings, a: SettingsActions): RenderNode[] {
  const { Text } = el
  return [
    row(el, 'warm', t(frame.lang, 'settings.keepWarm'), toggle(el, frame, 'set-warm', d.keepWarm ? t(frame.lang, 'band.on') : t(frame.lang, 'band.off'), d.keepWarm, () => a.patch({ keepWarm: !d.keepWarm })), t(frame.lang, 'settings.keepWarmHint')),
    row(
      el,
      'warm-hours',
      t(frame.lang, 'settings.for'),
      segmented(el, frame, 'warm-hours', ([1, 2, 4, 8] as const).map(n => ({ value: String(n), label: t(frame.lang, 'units.hours', { n }) })), String(d.keepWarmHours), ht => a.patch({ keepWarmHours: Number(ht) as Settings['keepWarmHours'] })),
      t(frame.lang, 'settings.afterReply'),
    ),
    row(
      el,
      'warm-min',
      t(frame.lang, 'settings.chatsFrom'),
      segmented(el, frame, 'warm-min', [10_000, 30_000, 60_000, 100_000].map(n => ({ value: String(n), label: n / 1000 + 'k' })), String(d.keepWarmMinTokens), n => a.patch({ keepWarmMinTokens: Number(n) })),
      t(frame.lang, 'settings.tokens'),
    ),
    row(el, 'warm-cost', '', <Text dimColor wrap="wrap">{t(frame.lang, 'settings.warmCost')}</Text>),
  ]
}

function handoffCard(el: Els, frame: Frame, view: SettingsView, a: SettingsActions): RenderNode[] {
  const d = view.draft
  const skills = [{ value: '', label: t(frame.lang, 'settings.noSkill') }, ...view.skills.map(s => ({ value: s, label: s }))]
  return [
    row(el, 'compact-with', t(frame.lang, 'settings.compactWith'), segmented(el, frame, 'compact-with', [{ value: 'haiku', label: t(frame.lang, 'settings.haiku') }, { value: 'session', label: t(frame.lang, 'settings.sessionCompactor') }] as const, d.compactWith, compactWith => a.patch({ compactWith }))),
    row(
      el,
      'handoff-after',
      t(frame.lang, 'settings.afterHandoff'),
      segmented(el, frame, 'handoff-after', [{ value: 'continue', label: t(frame.lang, 'alerts.continue') }, { value: 'confirm', label: t(frame.lang, 'alerts.confirm') }, { value: 'copy', label: t(frame.lang, 'alerts.copy') }] as const, d.handoffAfter, handoffAfter => a.patch({ handoffAfter })),
    ),
    row(
      el,
      'handoff-button',
      t(frame.lang, 'settings.handoffButton'),
      segmented(el, frame, 'handoff-button', [{ value: 'advised', label: t(frame.lang, 'settings.whenAdvised') }, { value: 'always', label: t(frame.lang, 'settings.always') }] as const, d.handoffButton, handoffButton => a.patch({ handoffButton })),
    ),
    row(el, 'handoff-skill', t(frame.lang, 'settings.fullHandoff'), picker(el, 'handoff-skill', skills, d.handoffSkill, handoffSkill => a.patch({ handoffSkill }))),
    row(
      el,
      'swamp-at',
      t(frame.lang, 'settings.heavyAt'),
      segmented(el, frame, 'swamp-at', [40, 50, 60, 70].map(n => ({ value: String(n), label: n + '%' })), String(d.swampAt), n => a.patch({ swampAt: Number(n) })),
      t(frame.lang, 'settings.context'),
    ),
  ]
}

const PARTS: readonly { value: string; label: string }[] = [
  { value: 'timer', label: 'settings.cacheTimer' },
  { value: 'reason', label: 'settings.reason' },
  { value: 'route', label: 'settings.route' },
  { value: 'limits', label: 'settings.limits' },
]

function lookCard(el: Els, frame: Frame, d: Settings, a: SettingsActions): RenderNode[] {
  const { Box } = el
  return [
    row(el, 'language', t(frame.lang, 'settings.language'), picker(el, 'language', [
      { value: 'auto', label: t(frame.lang, 'band.auto') },
      { value: 'ko', label: '한국어' }, { value: 'en', label: 'English' },
      { value: 'zh', label: '简体中文' }, { value: 'ja', label: '日本語' },
      { value: 'es', label: 'Español' }, { value: 'pt', label: 'Português' },
    ], d.language, language => a.patch({ language: language as Settings['language'] }))),
    row(el, 'layout', t(frame.lang, 'settings.layout'), segmented(el, frame, 'layout', [{ value: 'dashboard', label: t(frame.lang, 'settings.dashboard') }, { value: 'minimal', label: t(frame.lang, 'settings.minimal') }] as const, d.layout, layout => a.patch({ layout })), d.layout === 'minimal' ? t(frame.lang, 'settings.footerHint') : undefined),
    row(el, 'appearance', t(frame.lang, 'settings.appearance'), segmented(el, frame, 'appearance', [{ value: 'auto', label: t(frame.lang, 'band.auto') }, { value: 'dark', label: t(frame.lang, 'settings.dark') }, { value: 'light', label: t(frame.lang, 'settings.lightAppearance') }] as const, d.appearance, appearance => a.patch({ appearance }))),
    row(
      el,
      'parts',
      t(frame.lang, 'settings.show'),
      <Box flexDirection="row" flexWrap="wrap" gap={isRich(frame) ? 1 : 0} columnGap={2}>
        {PARTS.map(p => {
          const shown = !d.hide.includes(p.value)
          return toggle(el, frame, 'show-' + p.value, t(frame.lang, p.label), shown, () => a.patch({ hide: shown ? [...d.hide, p.value] : d.hide.filter(ht => ht !== p.value) }))
        })}
      </Box>,
    ),
  ]
}

// ---- The panel ---------------------------------------------------------------------------------

/** The settings panel for the band; fits `frame.maxRows` by dropping the card's blurb first. */
export function renderSettings(el: Els, frame: Frame, view: SettingsView, actions: SettingsActions): RenderNode {
  const { Box, Text } = el
  const rich = isRich(frame)
  const translateTab = (key: string) => t(frame.lang, key)
  const tab = TABS.find(t => t.value === view.tab) ?? TABS[0]!
  const d = view.draft
  const body =
    view.tab === 'effort'
      ? effortCard(el, frame, d, actions)
      : view.tab === 'workers'
        ? workersCard(el, frame, view, actions)
        : view.tab === 'judge'
          ? judgeCard(el, frame, view, actions)
          : view.tab === 'cache'
            ? cacheCard(el, frame, d, actions)
            : view.tab === 'handoff'
              ? handoffCard(el, frame, view, actions)
              : lookCard(el, frame, d, actions)
  // Header + tabs, blurb, rows, footer: on the terminal tabs take their own row under ~110 columns.
  const tabsOwnRow = !rich && frame.columns < 110
  const rows = 1 + (tabsOwnRow ? 1 : 0) + 1 + body.length + 1
  const showBlurb = rows <= frame.maxRows
  const tabs = segmented(
    el,
    frame,
    'tab',
    TABS.map(t => ({ value: t.value, label: translateTab(t.label), hotkey: t.hotkey })),
    view.tab,
    picked => actions.setTab(picked),
  )
  const tone = textTone(frame.appearance)
  const title = (
    <Box key="title" flexDirection="row" alignItems="center" columnGap={1}>
      <Text bold>{t(frame.lang, 'band.brand')}</Text>
      <Text dimColor>{t(frame.lang, 'settings.title')}</Text>
    </Box>
  )
  return (
    <Box flexDirection="column" rowGap={rich ? 1 : 0}>
      {tabsOwnRow ? (
        [title, <Box key="tabs">{tabs}</Box>]
      ) : (
        <Box key="head" flexDirection="row" alignItems="center" columnGap={3} flexWrap="wrap" rowGap={1}>
          {title}
          {tabs}
        </Box>
      )}
      {showBlurb ? (
        <Text dimColor>
          {t(frame.lang, tab.blurb)}
        </Text>
      ) : null}
      <Box key="card" flexDirection="column" rowGap={rich ? 1 : 0} paddingLeft={rich ? 1 : 0}>
        {body}
      </Box>
      <Box key="foot" flexDirection="row" alignItems="center" columnGap={2} flexWrap="wrap" rowGap={1}>
        {action(el, frame, 'save', t(frame.lang, 'settings.save'), actions.save, { hotkey: 's', primary: true })}
        {action(el, frame, 'close', view.dirty ? t(frame.lang, 'settings.discard') : t(frame.lang, 'settings.close'), actions.close, { hotkey: 'x' })}
        {view.dirty ? <Text color={tone.accent}>{t(frame.lang, 'settings.unsaved')}</Text> : null}
      </Box>
    </Box>
  )
}
