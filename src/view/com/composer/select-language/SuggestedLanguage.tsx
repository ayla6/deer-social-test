import {useEffect, useMemo, useState} from 'react'
import {Text as RNText, View} from 'react-native'
import {parseLanguage} from '@atproto/api'
import {msg, Trans} from '@lingui/macro'
import {useLingui} from '@lingui/react'
import {eldr} from 'eldr'

import {code3ToCode2, codeToLanguageName} from '#/locale/helpers'
import {useLanguagePrefs} from '#/state/preferences/languages'
import {atoms as a, useTheme} from '#/alf'
import {Button, ButtonText} from '#/components/Button'
import {Earth_Stroke2_Corner2_Rounded as EarthIcon} from '#/components/icons/Globe'
import {Text} from '#/components/Typography'

// fallbacks for safari
const onIdle = globalThis.requestIdleCallback || (cb => setTimeout(cb, 1))
const cancelIdle = globalThis.cancelIdleCallback || clearTimeout

export function SuggestedLanguage({
  text,
  replyToLanguages: replyToLanguagesProp,
  currentLanguages,
  onAcceptSuggestedLanguage,
}: {
  text: string
  /**
   * All languages associated with the post being replied to.
   */
  replyToLanguages: string[]
  /**
   * All languages currently selected for the post being composed.
   */
  currentLanguages: string[]
  /**
   * Called when the user accepts a suggested language. We only pass a single
   * language here. If the post being replied to has multiple languages, we
   * only suggest the first one.
   */
  onAcceptSuggestedLanguage: (language: string | null) => void
}) {
  const langPrefs = useLanguagePrefs()
  const replyToLanguages = replyToLanguagesProp
    .map(lang => cleanUpLanguage(lang))
    .filter(Boolean) as string[]
  const [hasInteracted, setHasInteracted] = useState(false)
  const [suggestedLanguage, setSuggestedLanguage] = useState<
    string | undefined
  >(undefined)
  const languageHistory = useMemo(
    () =>
      new Set(langPrefs.postLanguageHistory.map(lang => code3ToCode2(lang))),
    [langPrefs.postLanguageHistory],
  )
  const postLanguage = code3ToCode2(langPrefs.postLanguage)

  useEffect(() => {
    if (text.length > 0 && !hasInteracted) {
      setHasInteracted(true)
    }
  }, [text, hasInteracted])

  useEffect(() => {
    const textTrimmed = text.trim()

    // Don't run the language model on small posts, the results are likely
    // to be inaccurate anyway.
    if (textTrimmed.length < 20) {
      setSuggestedLanguage(undefined)
      return
    }

    const idle = onIdle(() => {
      setSuggestedLanguage(
        guessLanguage(textTrimmed, languageHistory, postLanguage),
      )
    })

    return () => cancelIdle(idle)
  }, [text, languageHistory, postLanguage])

  /*
   * We've detected a language, and the user hasn't already selected it.
   */
  const hasLanguageSuggestion =
    suggestedLanguage && !currentLanguages.includes(suggestedLanguage)
  /*
   * We have not detected a different language, and the user is not already
   * using or has not already selected one of the languages of the post they
   * are replying to.
   */
  const hasSuggestedReplyLanguage =
    !hasInteracted &&
    !suggestedLanguage &&
    replyToLanguages.length &&
    !replyToLanguages.some(l => currentLanguages.includes(l))

  if (hasLanguageSuggestion) {
    const suggestedLanguageName = codeToLanguageName(
      suggestedLanguage,
      langPrefs.appLanguage,
    )

    return (
      <LanguageSuggestionButton
        label={
          <RNText>
            <Trans>
              Are you writing in{' '}
              <Text style={[a.font_bold]}>{suggestedLanguageName}</Text>?
            </Trans>
          </RNText>
        }
        value={suggestedLanguage}
        onAccept={onAcceptSuggestedLanguage}
      />
    )
  } else if (hasSuggestedReplyLanguage) {
    const suggestedLanguageName = codeToLanguageName(
      replyToLanguages[0],
      langPrefs.appLanguage,
    )

    return (
      <LanguageSuggestionButton
        label={
          <RNText>
            <Trans>
              The post you're replying to was marked as being written in{' '}
              {suggestedLanguageName} by its author. Would you like to reply in{' '}
              <Text style={[a.font_bold]}>{suggestedLanguageName}</Text>?
            </Trans>
          </RNText>
        }
        value={replyToLanguages[0]}
        onAccept={onAcceptSuggestedLanguage}
      />
    )
  } else {
    return null
  }
}

function LanguageSuggestionButton({
  label,
  value,
  onAccept,
}: {
  label: React.ReactNode
  value: string
  onAccept: (language: string | null) => void
}) {
  const t = useTheme()
  const {_} = useLingui()

  return (
    <View style={[a.px_lg, a.py_sm]}>
      <View
        style={[
          a.gap_md,
          a.border,
          a.flex_row,
          a.align_center,
          a.rounded_sm,
          a.p_md,
          a.pl_lg,
          t.atoms.bg,
          t.atoms.border_contrast_low,
        ]}>
        <EarthIcon />
        <View style={[a.flex_1]}>
          <Text
            style={[
              a.leading_snug,
              {
                maxWidth: 400,
              },
            ]}>
            {label}
          </Text>
        </View>

        <Button
          size="small"
          color="secondary"
          onPress={() => onAccept(value)}
          label={_(msg`Accept this language suggestion`)}>
          <ButtonText>
            <Trans>Yes</Trans>
          </ButtonText>
        </Button>
      </View>
    </View>
  )
}

/**
 * This function is using the eldr language model to attempt to detect the language
 * We want to only make suggestions when we feel a high degree of certainty
 * The magic numbers are based on debugging sessions against some test strings
 */
function guessLanguage(
  text: string,
  languageHistory: Set<string>,
  postLanguage: string,
): string | undefined {
  const scores = eldr.detect(text).getScoresArray()

  let selected: string | undefined
  let selectedScore = 0.3

  for (const [lang, score] of scores) {
    const weightedScore =
      score *
      (languageHistory.has(lang) ? 2 : 1) *
      (postLanguage === lang ? 2 : 1)

    if (weightedScore >= selectedScore) {
      selected = lang
      selectedScore = weightedScore
    }
  }

  return selected
}

function cleanUpLanguage(text: string | undefined): string | undefined {
  if (!text) {
    return undefined
  }

  return parseLanguage(text)?.language
}
