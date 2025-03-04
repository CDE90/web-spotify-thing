import { Badge } from "@/components/ui/badge";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";

export function PercentageBadge({
    percentChange,
}: {
    percentChange: number | null;
}) {
    if (percentChange === null) return null;

    return (
        <Badge
            variant="outline"
            className={`flex items-center gap-1 px-1.5 py-0.5 text-xs ${
                percentChange > 0
                    ? "border-green-600/30 bg-green-600/10 text-green-600"
                    : percentChange < 0
                      ? "border-red-600/30 bg-red-600/10 text-red-600"
                      : "border-gray-500/30 bg-gray-500/10 text-gray-500"
            } `}
        >
            {percentChange > 0 ? (
                <ArrowUp className="h-3 w-3" />
            ) : percentChange < 0 ? (
                <ArrowDown className="h-3 w-3" />
            ) : (
                <Minus className="h-3 w-3" />
            )}
            {Math.abs(percentChange).toFixed(1)}%
        </Badge>
    );
}
