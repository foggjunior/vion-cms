# Daily itinerary costs and profit — 9 November 2026

Each quotation or tour-cost itinerary day has an **Open daily costs / Close daily costs** button. The panel starts closed. Closing it retains entries and its subtotal. Its open/closed state survives ordinary day redraws during the current editor session; reopening the saved quotation starts with panels closed.

The Profit base/Category column has been removed. Cost labels, rates, charging basis, quantity and calculated line totals remain. The charging choices are Per adult, Per child, Per day, Per room/night, Per vehicle and Once per trip. Per traveller is not offered on new lines.

## Quantities

- Per adult automatically uses the quotation adult count; Per child uses the child count. Both quantities are read-only and update when the party changes.
- Use **Add child rate** on a per-adult line to add a separate child line with its own price. The child rate is grouped with the original fee for profit selection. A zero child count contributes zero without requiring an invented child price.
- Per day is one charge on the current itinerary day. It is not multiplied by the full itinerary length or party count. Add the charge to each day on which it applies.
- Room/night and vehicle quantities are manually entered and independent of adult/child counts. For example, two rooms for one night means quantity 2 on that day.
- Once per trip is one charge; place it only on the applicable day to avoid counting it again.

Old records using the former combined-person basis remain readable and retain their original arithmetic. When present, that saved value is labelled **Saved: adults + children**. It is not silently converted to per adult, which would change saved quotations involving children.

## Summary and profit

Immediately after the itinerary days and before Introduction for guest, the editor shows:

1. Day subtotals and **Total itinerary cost** across included cost lines on all days.
2. A **Profit calculator**: choose a cost group and enter the markup percentage. Accommodation is offered as a group; other costs use their labels. Multiple non-overlapping groups can have different percentages.
3. **Profit amount** and **Grand total (guest price)**. The grand total is total itinerary costs plus calculated profit.

Example: accommodation costs 250 at 30% yield profit 75; transport costs 30 at 10% yield profit 3. If all itinerary costs are 305, total profit is 78 and the guest price is 383.

All itinerary costs may be selected as one rule. It cannot be combined with another rule, and duplicate cost-group rules are rejected to prevent accidental double markup. Remove all rules, or use zero percent, for no profit. The default rule preserves the previous 30% accommodation markup for new quotations. Old quotations without rules retain their saved accommodation percentage.

Calculations use integer cents. Each cost group's profit is rounded once to cents and then profits are summed. Blank applicable rates remain incomplete rather than becoming free. Excluded lines contribute zero. Supplier amounts, group selections and profit rules remain private. The guest PDF uses the same calculated grand total, without including internal costs or profit rules. Later rate-card changes do not change saved quotation cost snapshots.

## Validation

56 isolated server tests passed, including 11 new quantity/profit checks. 24 isolated Chrome checks passed for the toggles, automatic/manual quantities, multi-day totals, profit rules, saved rules, guest projection, summary placement and phone layout. The 25 inline-accommodation browser checks and 94 original storage/validation checks also passed.

No environment/credential files or real databases were accessed. Next build/dev commands were not run because they load owner-protected environment files. The owner restarts the local CMS personally to load regenerated assets and server modules.
