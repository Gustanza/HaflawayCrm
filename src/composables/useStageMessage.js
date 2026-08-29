/**
 * Turning a `validateTransition()` result into a sentence a user can act on.
 *
 * The domain layer deliberately knows nothing about vue-i18n or the viewer's locale, so
 * the messages it returns are developer-facing: they name the STORAGE PATH of the missing
 * field. That leaked straight into a toast on the pipeline board —
 *
 *     "Fill in dealValueMinor before moving to won."
 *
 * — which asks a Swahili-speaking agent to fill in a camelCase identifier that appears
 * nowhere in the interface, in a language the rest of the screen is not written in.
 *
 * So the domain keeps returning the machine-readable `{ code, missing }`, which is what
 * makes it testable, and this turns that into words. Any new STAGE_REQUIREMENTS entry needs
 * a matching `fieldName.*` message, or the user is back to reading a field path.
 */
import { useI18n } from 'vue-i18n'

export function useStageMessage() {
  const { t, te } = useI18n()

  /**
   * A dotted storage path becomes a human name. Keys are flattened with `_` because a dot
   * is vue-i18n's own path separator — `fieldName.qualification.budgetBand` would be read
   * as three levels of nesting rather than one key.
   *
   * Falls back to the raw path rather than rendering an empty string: a developer-looking
   * word is bad, a message with a blank hole in it is worse.
   */
  function fieldLabel(path) {
    const key = `fieldName.${String(path).replace(/\./g, '_')}`
    return te(key) ? t(key) : path
  }

  /**
   * @param check   the result of validateTransition()
   * @param toStage the stage the user was trying to reach
   */
  function messageFor(check, toStage) {
    if (!check || check.ok) return ''

    const stage = toStage ? t(`stage.${toStage}`) : ''

    switch (check.code) {
      case 'MISSING_FIELDS':
        return t('stageMove.missing', {
          fields: (check.missing ?? []).map(fieldLabel).join(', '),
          stage,
        })
      // Distinct from a missing value: the field IS filled in, with a number that cannot
      // be true. "Add the deal value" would be baffling advice to someone who just did.
      case 'INVALID_DEAL_VALUE':
        return t('stageMove.zeroValue')
      case 'REOPEN_FORBIDDEN':
        return t('stageMove.reopenForbidden')
      default:
        return t('pipeline.cannotMove')
    }
  }

  /** True when the block is something the user can clear by filling a form in. */
  function isFixable(check) {
    return check?.code === 'MISSING_FIELDS' || check?.code === 'INVALID_DEAL_VALUE'
  }

  return { messageFor, fieldLabel, isFixable }
}
