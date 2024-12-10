"use client";

import { DateRangePicker } from "@/components/DateRangePicker";
import { useRouter, useSearchParams } from "next/navigation";

export function DateSelector({
    baseUrl,
    className,
}: Readonly<{
    baseUrl: string;
    className?: string;
}>) {
    const searchParams = useSearchParams();

    const router = useRouter();

    // Get the start date and end date from the search params
    const startDate = searchParams.get("from")
        ? new Date(searchParams.get("from")!)
        : new Date(new Date().getTime() - 365 * 24 * 60 * 60 * 1000);
    startDate.setHours(0, 0, 0, 0);
    const endDate = searchParams.get("to")
        ? new Date(searchParams.get("to")!)
        : new Date();
    endDate.setHours(23, 59, 59, 999);

    const presets = [
        {
            label: "Today",
            dateRange: {
                from: new Date(),
                to: new Date(),
            },
        },
        {
            label: "Last 7 days",
            dateRange: {
                from: new Date(new Date().setDate(new Date().getDate() - 7)),
                to: new Date(),
            },
        },
        {
            label: "Last 30 days",
            dateRange: {
                from: new Date(new Date().setDate(new Date().getDate() - 30)),
                to: new Date(),
            },
        },
        {
            label: "Last 3 months",
            dateRange: {
                from: new Date(new Date().setMonth(new Date().getMonth() - 3)),
                to: new Date(),
            },
        },
        {
            label: "Last 6 months",
            dateRange: {
                from: new Date(new Date().setMonth(new Date().getMonth() - 6)),
                to: new Date(),
            },
        },
        {
            label: "Month to date",
            dateRange: {
                from: new Date(new Date().setDate(1)),
                to: new Date(),
            },
        },
        {
            label: "Year to date",
            dateRange: {
                from: new Date(
                    new Date().setFullYear(new Date().getFullYear(), 0, 1),
                ),
                to: new Date(),
            },
        },
    ];

    return (
        <DateRangePicker
            className={className}
            onChange={(value) => {
                const url = new URL(
                    `${baseUrl}/dashboard?${searchParams.toString()}`,
                );
                value?.from?.setHours(0, 0, 0, 0);
                value?.to?.setHours(23, 59, 59, 999);
                if (value?.from) {
                    url.searchParams.set(
                        "from",
                        value.from.toISOString().split("T")[0]!,
                    );
                } else {
                    url.searchParams.delete("from");
                }
                if (value?.to) {
                    url.searchParams.set(
                        "to",
                        value.to.toISOString().split("T")[0]!,
                    );
                } else {
                    url.searchParams.delete("to");
                }
                router.push(url.toString());
            }}
            presets={presets}
            value={{
                from: startDate,
                to: endDate,
            }}
            toDate={endDate}
            enableYearNavigation
            required
        />
    );
}
