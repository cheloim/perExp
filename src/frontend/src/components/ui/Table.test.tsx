import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import Table, { TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "./Table";
import type { SortDirection } from "./Table";

function IncomeTable({ captionHidden = false }: { captionHidden?: boolean }) {
  const [sort, setSort] = useState<SortDirection>("ascending");

  return (
    <Table caption="Gastos de octubre" captionHidden={captionHidden}>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Fecha</TableHeaderCell>
          <TableHeaderCell
            sort={sort}
            onSort={() => setSort(sort === "ascending" ? "descending" : "ascending")}
          >
            Monto
          </TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        <TableRow>
          <TableCell>01/10/2026</TableCell>
          <TableCell>$ 1.000,00</TableCell>
        </TableRow>
        <TableRow>
          <TableHeaderCell scope="row">Total</TableHeaderCell>
          <TableCell>$ 1.000,00</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

describe("Table", () => {
  it("uses the caption as the accessible name", () => {
    render(<IncomeTable captionHidden />);

    expect(screen.getByRole("table", { name: "Gastos de octubre" })).toBeInTheDocument();
  });

  it("marks header cells with column scope by default and allows row scope", () => {
    render(<IncomeTable />);

    const [dateHeader, amountHeader] = screen.getAllByRole("columnheader");
    expect(dateHeader).toHaveAttribute("scope", "col");
    expect(amountHeader).toHaveAttribute("scope", "col");
    expect(screen.getByRole("rowheader", { name: "Total" })).toHaveAttribute("scope", "row");
  });

  it("exposes and updates aria-sort from the sortable header", () => {
    render(<IncomeTable />);

    const amountHeader = screen.getByRole("columnheader", { name: "Monto" });
    expect(amountHeader).toHaveAttribute("aria-sort", "ascending");

    fireEvent.click(screen.getByRole("button", { name: "Monto" }));

    expect(amountHeader).toHaveAttribute("aria-sort", "descending");
  });

  it("renders plain headers without sort state", () => {
    render(<IncomeTable />);

    expect(screen.getByRole("columnheader", { name: "Fecha" })).not.toHaveAttribute("aria-sort");
  });
});
