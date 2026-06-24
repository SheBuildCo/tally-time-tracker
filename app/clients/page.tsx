"use client";

import {
  BarChart,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Text,
  Title,
} from "@tremor/react";
import LoadingGate from "@/components/LoadingGate";
import { formatCurrency, formatHours } from "@/lib/format";

export default function ClientsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
        <p className="text-sm text-gray-500">
          Hours and billable value per client.
        </p>
      </div>

      <LoadingGate>
        {(report) => {
          const billed = report.clients.filter((c) => c.hours > 0);
          const chartData = billed
            .slice(0, 10)
            .map((c) => ({ name: c.name, Hours: c.hours }));

          return (
            <div className="space-y-6">
              <Card>
                <Title>Hours by client</Title>
                <BarChart
                  className="mt-4 h-72"
                  data={chartData}
                  index="name"
                  categories={["Hours"]}
                  colors={["blue"]}
                  valueFormatter={(v) => formatHours(v)}
                  layout="vertical"
                  showLegend={false}
                />
              </Card>

              <Card>
                <Title>Billables</Title>
                <Text>Billable hours and value by client</Text>
                <Table className="mt-4">
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Client</TableHeaderCell>
                      <TableHeaderCell className="text-right">
                        Total
                      </TableHeaderCell>
                      <TableHeaderCell className="text-right">
                        Billable
                      </TableHeaderCell>
                      <TableHeaderCell className="text-right">
                        Value
                      </TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {billed.map((c) => (
                      <TableRow key={`${c.clientId}`}>
                        <TableCell className="font-medium text-gray-900">
                          {c.name}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatHours(c.hours)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatHours(c.billableHours)}
                        </TableCell>
                        <TableCell className="text-right font-medium text-emerald-600">
                          {c.amount > 0 ? formatCurrency(c.amount) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </div>
          );
        }}
      </LoadingGate>
    </div>
  );
}
