"use client";

import {
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Title,
} from "@tremor/react";
import LoadingGate from "@/components/LoadingGate";
import { formatHours } from "@/lib/format";

export default function AppsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Apps &amp; Sites</h1>
        <p className="text-sm text-gray-500">
          Time per application and website, and which client it rolled up to.
        </p>
      </div>

      <LoadingGate>
        {(report) => (
          <Card>
            <Title>Usage by app &amp; site</Title>
            <Table className="mt-4">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>App / Site</TableHeaderCell>
                  <TableHeaderCell>Top client</TableHeaderCell>
                  <TableHeaderCell className="text-right">
                    Total
                  </TableHeaderCell>
                  <TableHeaderCell className="text-right">
                    Billable
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {report.apps.slice(0, 50).map((a) => (
                  <TableRow key={a.label}>
                    <TableCell className="font-medium text-gray-900">
                      {a.label}
                      <span className="ml-2 text-xs text-gray-400">
                        {a.label !== a.app ? a.app : ""}
                      </span>
                    </TableCell>
                    <TableCell className="text-gray-600">
                      {a.topClient}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatHours(a.hours)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatHours(a.billableHours)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </LoadingGate>
    </div>
  );
}
