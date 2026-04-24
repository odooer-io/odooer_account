/** @odoo-module **/
import { Component, useState, onWillUpdateProps } from "@odoo/owl";
import { rpc } from "@web/core/network/rpc";

export class BankRecForm extends Component {
    static template = "odooer_account.BankRecForm";
    static props = {
        recData: Object,
        onReconciled: Function,
        onReloadData: Function,
    };

    setup() {
        this.state = useState({
            // Partner editing
            showPartnerEdit: false,
            partnerSearch: '',
            partnerSuggestions: [],
            partnerLoading: false,

            // Pending lines (accumulated before validate)
            pendingLines: [],

            // Add-line panel: null | 'match_entry' | 'set_account'
            addMode: null,

            // Match entry sub-state
            candidateSearch: '',
            candidates: [],
            candidatesLoading: false,

            // Set account sub-state
            accountSearch: '',
            accountSuggestions: [],
            accountLoading: false,
            selectedAccount: null,    // {id, name}
            accountAmount: '',
            accountLabel: '',
            accountPartnerSearch: '',
            accountPartnerSuggestions: [],
            selectedAccountPartner: null, // {id, name}

            // Global
            processing: false,
            error: null,
        });

        this._debounceTimers = {};

        onWillUpdateProps(() => {
            // Reset transient UI when switching to another transaction
            this.state.showPartnerEdit = false;
            this.state.partnerSearch = '';
            this.state.partnerSuggestions = [];
            this.state.pendingLines = [];
            this.state.addMode = null;
            this.state.candidates = [];
            this.state.candidateSearch = '';
            this.state.selectedAccount = null;
            this.state.accountSearch = '';
            this.state.accountAmount = '';
            this.state.accountLabel = '';
            this.state.selectedAccountPartner = null;
            this.state.error = null;
        });
    }

    get recData() {
        return this.props.recData;
    }

    /** Amount of the transaction still unaccounted for by pending lines */
    get remainingAmount() {
        const matched = this.state.pendingLines.reduce((s, l) => s + l.amount, 0.0);
        return (this.props.recData.amount_residual || 0) - matched;
    }

    get isBalanced() {
        return Math.abs(this.remainingAmount) < 0.005;
    }

    // ── Debounce helper ─────────────────────────────────────────────────────

    _debounce(key, fn, delay = 300) {
        clearTimeout(this._debounceTimers[key]);
        this._debounceTimers[key] = setTimeout(fn, delay);
    }

    // ── Partner ──────────────────────────────────────────────────────────────

    togglePartnerEdit() {
        this.state.showPartnerEdit = !this.state.showPartnerEdit;
        this.state.partnerSearch = '';
        this.state.partnerSuggestions = [];
    }

    onPartnerSearchInput(ev) {
        this.state.partnerSearch = ev.target.value;
        this._debounce('partner', () => this._searchPartners(), 300);
    }

    async _searchPartners() {
        const term = this.state.partnerSearch;
        if (!term || term.length < 2) {
            this.state.partnerSuggestions = [];
            return;
        }
        this.state.partnerLoading = true;
        try {
            this.state.partnerSuggestions = await rpc('/odooer/bank_rec/search_partners', { term });
        } finally {
            this.state.partnerLoading = false;
        }
    }

    async selectPartner(partner) {
        this.state.processing = true;
        this.state.error = null;
        try {
            const updated = await rpc('/odooer/bank_rec/update_partner', {
                st_line_id: this.recData.id,
                partner_id: partner.id,
            });
            this.state.showPartnerEdit = false;
            this.state.partnerSuggestions = [];
            // Reload candidates if in match_entry mode (filter may change)
            if (this.state.addMode === 'match_entry') {
                this.state.candidates = [];
            }
            this.props.onReloadData(updated);
        } catch (e) {
            this.state.error = e.message || 'Error setting partner';
        }
        this.state.processing = false;
    }

    async clearPartner() {
        this.state.processing = true;
        this.state.error = null;
        try {
            const updated = await rpc('/odooer/bank_rec/update_partner', {
                st_line_id: this.recData.id,
                partner_id: false,
            });
            this.state.showPartnerEdit = false;
            this.props.onReloadData(updated);
        } catch (e) {
            this.state.error = e.message || 'Error clearing partner';
        }
        this.state.processing = false;
    }

    // ── AR / AP quick-add ────────────────────────────────────────────────────

    async addArApLine(accountType) {
        this.state.error = null;
        try {
            const account = await rpc('/odooer/bank_rec/get_ar_ap_account', {
                partner_id: this.recData.partner_id,
                account_type: accountType,
            });
            if (!account) {
                this.state.error = 'No AR/AP account configured for this partner';
                return;
            }
            const remaining = this.remainingAmount;
            if (Math.abs(remaining) < 0.005) {
                this.state.error = 'Transaction is already fully matched';
                return;
            }
            const label = accountType === 'asset_receivable' ? 'Receivable' : 'Payable';
            this.state.pendingLines.push({
                type: 'account',
                account_id: account.id,
                account_name: account.name,
                partner_id: this.recData.partner_id,
                partner_name: this.recData.partner_name,
                label: this.recData.payment_ref || label,
                amount: remaining,  // signed: negative for outgoing transactions
            });
        } catch (e) {
            this.state.error = e.message || 'Error loading AR/AP account';
        }
    }

    // ── Match existing entry ─────────────────────────────────────────────────

    setAddMode(mode) {
        this.state.addMode = this.state.addMode === mode ? null : mode;
        this.state.error = null;
        if (mode === 'match_entry' && this.state.candidates.length === 0) {
            this._loadCandidates();
        }
        if (mode === 'set_account' && !this.state.accountLabel) {
            this.state.accountLabel = this.recData.payment_ref || '';
        }
    }

    onCandidateSearchInput(ev) {
        this.state.candidateSearch = ev.target.value;
        this._debounce('candidates', () => this._loadCandidates(), 400);
    }

    async _loadCandidates() {
        this.state.candidatesLoading = true;
        try {
            this.state.candidates = await rpc('/odooer/bank_rec/get_candidates', {
                st_line_id: this.recData.id,
                search_term: this.state.candidateSearch,
                limit: 20,
            });
        } finally {
            this.state.candidatesLoading = false;
        }
    }

    addAmlLine(candidate) {
        if (this.state.pendingLines.some(l => l.type === 'aml' && l.aml_id === candidate.id)) {
            this.state.error = 'This entry is already in the list';
            return;
        }
        const remaining = this.remainingAmount;
        if (Math.abs(remaining) < 0.005) {
            this.state.error = 'Transaction is already fully matched';
            return;
        }
        // Preserve the sign of remainingAmount so the balance math stays correct;
        // cap the absolute value at what the AML actually has open.
        const amount = Math.sign(remaining) * Math.min(Math.abs(candidate.amount_residual), Math.abs(remaining));
        this.state.pendingLines.push({
            type: 'aml',
            aml_id: candidate.id,
            account_name: candidate.account_display,
            partner_name: candidate.partner_name,
            label: candidate.move_name,
            amount,
        });
        this.state.error = null;
    }

    // ── Set account directly ─────────────────────────────────────────────────

    onAccountSearchInput(ev) {
        this.state.accountSearch = ev.target.value;
        this.state.selectedAccount = null;
        this._debounce('accounts', () => this._searchAccounts(), 300);
    }

    async _searchAccounts() {
        const term = this.state.accountSearch;
        if (!term || term.length < 2) {
            this.state.accountSuggestions = [];
            return;
        }
        this.state.accountLoading = true;
        try {
            this.state.accountSuggestions = await rpc('/odooer/bank_rec/search_accounts', { term });
        } finally {
            this.state.accountLoading = false;
        }
    }

    selectAccount(account) {
        this.state.selectedAccount = account;
        this.state.accountSearch = account.name;
        this.state.accountSuggestions = [];
        // Default to the remaining signed amount so money-out transactions get a negative prefill
        if (!this.state.accountAmount) {
            this.state.accountAmount = this.remainingAmount.toFixed(2);
        }
    }

    onAccountAmountInput(ev) {
        this.state.accountAmount = ev.target.value;
    }

    onAccountLabelInput(ev) {
        this.state.accountLabel = ev.target.value;
    }

    onAccountPartnerSearchInput(ev) {
        this.state.accountPartnerSearch = ev.target.value;
        this.state.selectedAccountPartner = null;
        this._debounce('acct_partner', () => this._searchAccountPartner(), 300);
    }

    async _searchAccountPartner() {
        const term = this.state.accountPartnerSearch;
        if (!term || term.length < 2) {
            this.state.accountPartnerSuggestions = [];
            return;
        }
        const results = await rpc('/odooer/bank_rec/search_partners', { term });
        this.state.accountPartnerSuggestions = results;
    }

    selectAccountPartner(partner) {
        this.state.selectedAccountPartner = partner;
        this.state.accountPartnerSearch = partner.name;
        this.state.accountPartnerSuggestions = [];
    }

    addAccountLine() {
        if (!this.state.selectedAccount) {
            this.state.error = 'Please select an account';
            return;
        }
        const amount = parseFloat(this.state.accountAmount);
        if (!amount || isNaN(amount)) {
            this.state.error = 'Please enter a valid amount';
            return;
        }
        this.state.pendingLines.push({
            type: 'account',
            account_id: this.state.selectedAccount.id,
            account_name: this.state.selectedAccount.name,
            partner_id: this.state.selectedAccountPartner?.id || this.recData.partner_id || null,
            partner_name: this.state.selectedAccountPartner?.name || this.recData.partner_name || '',
            label: this.state.accountLabel || this.recData.payment_ref || '',
            amount,
        });
        // Reset account form
        this.state.selectedAccount = null;
        this.state.accountSearch = '';
        this.state.accountAmount = '';
        this.state.accountLabel = '';
        this.state.selectedAccountPartner = null;
        this.state.accountPartnerSearch = '';
        this.state.addMode = null;
        this.state.error = null;
    }

    // ── Pending lines management ─────────────────────────────────────────────

    removePendingLine(idx) {
        this.state.pendingLines.splice(idx, 1);
        this.state.error = null;
    }

    // ── Validate / Unmatch ───────────────────────────────────────────────────

    async validateAll() {
        this.state.processing = true;
        this.state.error = null;
        try {
            const lines = this.state.pendingLines.map(l => ({
                type: l.type === 'aml' ? 'aml' : 'account',
                aml_id: l.aml_id || null,
                account_id: l.account_id || null,
                partner_id: l.partner_id || null,
                label: l.label || '',
                amount: l.amount,
            }));
            const result = await rpc('/odooer/bank_rec/validate_lines', {
                st_line_id: this.recData.id,
                pending_lines: lines,
            });
            if (result.error) {
                this.state.error = result.error;
            } else {
                this.props.onReconciled();
            }
        } catch (e) {
            this.state.error = e.message || 'Error during reconciliation';
        }
        this.state.processing = false;
    }

    async unmatch() {
        this.state.processing = true;
        this.state.error = null;
        try {
            await rpc('/odooer/bank_rec/unmatch', { st_line_id: this.recData.id });
            this.state.pendingLines = [];
            this.props.onReloadData();
        } catch (e) {
            this.state.error = e.message || 'Error undoing reconciliation';
        }
        this.state.processing = false;
    }
}
