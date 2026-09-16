/**
 * Leads, deals and activities — the UI-facing wrapper around services/*.service.js.
 *
 * Components call these actions rather than importing the service modules directly, so they
 * never have to thread `user` through by hand — it comes from the auth store every time.
 */

import { defineStore } from 'pinia'
import { doc } from 'firebase/firestore'
import { getDb } from '@/firebase/app.js'
import { useAuthStore } from '@/stores/auth.js'
import { useCollection, useDoc } from '@/composables/useCollection.js'
import { workQueueQuery, leadListQuery, leadDealsQuery, leadTimelineQuery } from '@/services/queries.js'
import * as leadsService from '@/services/leads.service.js'
import * as dealsService from '@/services/deals.service.js'
import * as activitiesService from '@/services/activities.service.js'

/** The auth store's shape, as the services expect it: { uid, orgId, teamId, role, displayName }. */
function actingUser(auth) {
  return {
    uid: auth.uid,
    orgId: auth.orgId,
    teamId: auth.teamId,
    role: auth.role,
    displayName: auth.displayName,
  }
}

export const useLeadsStore = defineStore('leads', () => {
  const auth = useAuthStore()

  /** The Work Queue — live, so a follow-up logged on another device updates immediately. */
  function workQueue() {
    return useCollection(() => workQueueQuery(actingUser(auth)), { live: true })
  }

  /** The lead list — one-shot with pagination. */
  function leadList() {
    return useCollection((after) => leadListQuery(actingUser(auth), { after }), {
      pageSize: 50,
    })
  }

  /** One lead, live. */
  function lead(leadId) {
    return useDoc(async () => {
      const db = await getDb()
      return doc(db, 'leads', leadId)
    })
  }

  /** One lead's deals, live — the product cards. */
  function deals(leadId) {
    return useCollection(() => leadDealsQuery(leadId), { live: true })
  }

  /** One lead's timeline, newest first, one-shot with pagination. */
  function timeline(leadId) {
    return useCollection((after) => leadTimelineQuery(leadId, { after }), { pageSize: 50 })
  }

  async function createLead(input) {
    return leadsService.createLead({ input, user: actingUser(auth) })
  }

  async function updateLead(leadId, patch) {
    return leadsService.updateLead({ leadId, patch, user: actingUser(auth) })
  }

  async function reassignLead(lead, toUserId) {
    return leadsService.reassignLead({ lead, toUserId, user: actingUser(auth) })
  }

  async function deleteLead(lead, onProgress) {
    return leadsService.deleteLead({ lead, user: actingUser(auth), onProgress })
  }

  async function addDeal(leadId, orgId, productType) {
    return dealsService.addDeal({ leadId, orgId, productType, user: actingUser(auth) })
  }

  async function closeDeal(leadId, dealId, status, lostReason) {
    return dealsService.closeDeal({ leadId, dealId, status, lostReason, user: actingUser(auth) })
  }

  async function reopenDeal(leadId, dealId) {
    return dealsService.reopenDeal({ leadId, dealId, user: actingUser(auth) })
  }

  async function deleteDeal(leadId, dealId) {
    return dealsService.deleteDeal({ leadId, dealId })
  }

  async function logActivity({ leadId, channel, outcome, summary, dealId, nextFollowUpAt }) {
    return activitiesService.logActivity({
      leadId, channel, outcome, summary, dealId, nextFollowUpAt, user: actingUser(auth),
    })
  }

  async function voidActivity(leadId, activityId, reason) {
    return activitiesService.voidActivity({ leadId, activityId, reason, user: actingUser(auth) })
  }

  async function setNextFollowUp(leadId, at) {
    return activitiesService.setNextFollowUp({ leadId, at, user: actingUser(auth) })
  }

  async function checkPhoneAvailable(rawPhone) {
    return leadsService.checkPhoneAvailable(rawPhone, auth.orgId)
  }

  return {
    workQueue, leadList, lead, deals, timeline,
    createLead, updateLead, reassignLead, deleteLead,
    addDeal, closeDeal, reopenDeal, deleteDeal,
    logActivity, voidActivity, setNextFollowUp,
    checkPhoneAvailable,
  }
})
