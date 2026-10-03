import "server-only";
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { registerInvoicePdfFonts, INVOICE_PDF_FONT_FAMILY } from "@/lib/invoices/pdf/fonts";
import type { QuotePdfViewModel, QuotePdfAddress } from "./view-model";

/**
 * Quote PDF — current-state, on-demand document template (schema-free
 * slice). This module performs NO database read, NO Storage read, and NO
 * auth check of any kind — a pure rendering function of exactly one input
 * type (`QuotePdfViewModel`), mirroring
 * src/lib/invoices/pdf/document.tsx's own identical boundary. Font
 * registration is reused as-is (registerInvoicePdfFonts/
 * INVOICE_PDF_FONT_FAMILY are already fully domain-neutral — they embed
 * the Noto Sans TTFs this entire app's PDF output uses, nothing
 * Invoice-specific about them). The page layout/styles below are a
 * deliberately separate, Quote-shaped copy rather than importing
 * Invoice's own StyleSheet — matching this codebase's own established
 * "don't make an Invoice-specific abstraction dangerously generic merely
 * to reuse it" convention (see e.g. duplicate.ts's own per-module-copy
 * precedent).
 */

const styles = StyleSheet.create({
  page: {
    fontFamily: INVOICE_PDF_FONT_FAMILY,
    fontSize: 10,
    color: "#1a1a1a",
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 48,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
  },
  logo: { width: 96, height: 48, objectFit: "contain" },
  issuerBlock: { maxWidth: 260 },
  legalName: { fontSize: 13, fontWeight: "bold", marginBottom: 4 },
  addressLine: { fontSize: 9, color: "#4a4a4a", marginBottom: 1 },
  quoteMetaBlock: { alignItems: "flex-end" },
  quoteTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 4 },
  quoteNumber: { fontSize: 10, color: "#4a4a4a", marginBottom: 2 },
  statusLabel: { fontSize: 10, fontWeight: "bold", marginTop: 4 },
  documentTitleRow: { marginBottom: 16 },
  documentTitleText: { fontSize: 12, fontWeight: "bold" },
  datesRow: { flexDirection: "row", marginBottom: 24, gap: 32 },
  dateBlock: {},
  dateLabel: { fontSize: 8, color: "#7a7a7a", marginBottom: 2, textTransform: "uppercase" },
  dateValue: { fontSize: 10 },
  partiesRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  partyBlock: { maxWidth: 240 },
  partyLabel: { fontSize: 8, color: "#7a7a7a", marginBottom: 4, textTransform: "uppercase" },
  partyName: { fontSize: 11, fontWeight: "bold", marginBottom: 2 },
  table: { marginBottom: 16, borderTop: "1pt solid #d0d0d0" },
  tableHeaderRow: {
    flexDirection: "row",
    borderBottom: "1pt solid #d0d0d0",
    paddingVertical: 6,
    backgroundColor: "#f7f7f7",
  },
  tableRow: {
    flexDirection: "row",
    borderBottom: "0.5pt solid #e5e5e5",
    paddingVertical: 6,
  },
  colDescription: { flex: 3, paddingHorizontal: 4 },
  colQuantity: { flex: 1, paddingHorizontal: 4, textAlign: "right" },
  colUnitPrice: { flex: 1.2, paddingHorizontal: 4, textAlign: "right" },
  colLineTotal: { flex: 1.2, paddingHorizontal: 4, textAlign: "right" },
  tableHeaderText: { fontSize: 8, fontWeight: "bold", color: "#4a4a4a", textTransform: "uppercase" },
  totalsBlock: { alignSelf: "flex-end", width: 220, marginBottom: 24 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  totalsLabel: { fontSize: 9, color: "#4a4a4a" },
  totalsValue: { fontSize: 9 },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTop: "1pt solid #1a1a1a",
    paddingTop: 6,
    marginTop: 4,
  },
  grandTotalLabel: { fontSize: 10, fontWeight: "bold" },
  grandTotalValue: { fontSize: 10, fontWeight: "bold" },
  section: { marginBottom: 16 },
  sectionLabel: { fontSize: 8, color: "#7a7a7a", marginBottom: 4, textTransform: "uppercase" },
  sectionText: { fontSize: 9, lineHeight: 1.4 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    fontSize: 8,
    color: "#9a9a9a",
    textAlign: "center",
  },
});

function AddressLines({ address, country }: { address: QuotePdfAddress; country: string | null }) {
  const lines = [address.streetAddress, [address.city, address.state, address.postalCode].filter(Boolean).join(", "), country].filter(
    (line): line is string => Boolean(line && line.length > 0),
  );
  return (
    <>
      {lines.map((line, index) => (
        <Text key={index} style={styles.addressLine}>
          {line}
        </Text>
      ))}
    </>
  );
}

export function QuotePdfDocument({ viewModel }: { viewModel: QuotePdfViewModel }) {
  registerInvoicePdfFonts();
  const { issuer, recipient, totals } = viewModel;

  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.headerRow}>
          <View style={styles.issuerBlock}>
            {/* react-pdf's <Image> renders to a PDF XObject, not an HTML <img> — no `alt` prop exists on its type, matching Invoice PDF's own identical, already-reviewed eslint-disable. */}
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            {issuer.logoImage && <Image src={issuer.logoImage.dataUri} style={styles.logo} />}
            <Text style={styles.legalName}>{issuer.legalName}</Text>
            <AddressLines address={issuer.address} country={issuer.country} />
            {issuer.supportEmail && <Text style={styles.addressLine}>{issuer.supportEmail}</Text>}
            {issuer.phone && <Text style={styles.addressLine}>{issuer.phone}</Text>}
            {issuer.website && <Text style={styles.addressLine}>{issuer.website}</Text>}
            {issuer.taxId && <Text style={styles.addressLine}>Tax ID: {issuer.taxId}</Text>}
          </View>
          <View style={styles.quoteMetaBlock}>
            <Text style={styles.quoteTitle}>Quote</Text>
            <Text style={styles.quoteNumber}>{viewModel.quoteNumber}</Text>
            <Text style={styles.statusLabel}>{viewModel.statusLabel}</Text>
          </View>
        </View>

        {viewModel.title && (
          <View style={styles.documentTitleRow}>
            <Text style={styles.documentTitleText}>{viewModel.title}</Text>
          </View>
        )}

        <View style={styles.datesRow}>
          <View style={styles.dateBlock}>
            <Text style={styles.dateLabel}>Issue date</Text>
            <Text style={styles.dateValue}>{viewModel.issueDateDisplay}</Text>
          </View>
          <View style={styles.dateBlock}>
            <Text style={styles.dateLabel}>Valid until</Text>
            <Text style={styles.dateValue}>{viewModel.validUntilDisplay ?? "—"}</Text>
          </View>
        </View>

        <View style={styles.partiesRow}>
          <View style={styles.partyBlock}>
            <Text style={styles.partyLabel}>From</Text>
            <Text style={styles.partyName}>{issuer.legalName}</Text>
          </View>
          <View style={styles.partyBlock}>
            <Text style={styles.partyLabel}>Quote for</Text>
            <Text style={styles.partyName}>{recipient.name}</Text>
            {recipient.email && <Text style={styles.addressLine}>{recipient.email}</Text>}
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeaderRow} fixed>
            <Text style={[styles.colDescription, styles.tableHeaderText]}>Description</Text>
            <Text style={[styles.colQuantity, styles.tableHeaderText]}>Qty</Text>
            <Text style={[styles.colUnitPrice, styles.tableHeaderText]}>Unit price</Text>
            <Text style={[styles.colLineTotal, styles.tableHeaderText]}>Line total</Text>
          </View>
          {viewModel.lineItems.map((item, index) => (
            <View key={index} style={styles.tableRow} wrap={false}>
              <Text style={styles.colDescription}>{item.description}</Text>
              <Text style={styles.colQuantity}>{item.quantity}</Text>
              <Text style={styles.colUnitPrice}>{item.unitPrice}</Text>
              <Text style={styles.colLineTotal}>{item.lineTotal}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsBlock} wrap={false}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text style={styles.totalsValue}>{totals.displayedSubtotal}</Text>
          </View>
          {totals.discountRow && (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>{totals.discountRow.label}</Text>
              <Text style={styles.totalsValue}>-{totals.discountRow.amount}</Text>
            </View>
          )}
          {totals.taxRow && (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>{totals.taxRow.label}</Text>
              <Text style={styles.totalsValue}>{totals.taxRow.amount}</Text>
            </View>
          )}
          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotalLabel}>Total</Text>
            <Text style={styles.grandTotalValue}>{totals.total}</Text>
          </View>
        </View>

        {viewModel.notes && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Notes</Text>
            <Text style={styles.sectionText}>{viewModel.notes}</Text>
          </View>
        )}

        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
        />
      </Page>
    </Document>
  );
}

/**
 * The one, narrow server-only rendering entry point — accepts an
 * already-built view model and returns a real PDF `Buffer`. No database,
 * Storage, or auth read occurs here or anywhere else in this module.
 */
export async function renderQuotePdfBuffer(viewModel: QuotePdfViewModel): Promise<Buffer> {
  return renderToBuffer(<QuotePdfDocument viewModel={viewModel} />);
}
