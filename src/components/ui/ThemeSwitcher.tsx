"use client";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@/components/Dropdown";
import { RiComputerLine, RiMoonLine, RiSunLine } from "@remixicon/react";

import { useTheme } from "next-themes";

export function ThemeSwitcher() {
    const { theme, setTheme } = useTheme();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger className="p-2 capitalize">
                Theme: {theme}
            </DropdownMenuTrigger>
            <DropdownMenuContent>
                <DropdownMenuRadioGroup
                    value={theme}
                    onValueChange={(value) => {
                        setTheme(value);
                    }}
                >
                    <DropdownMenuRadioItem
                        aria-label="Switch to Light Mode"
                        value="light"
                        // iconType="check"
                    >
                        <RiSunLine
                            className="size-4 shrink-0"
                            aria-hidden="true"
                        />
                        Light
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem
                        aria-label="Switch to Dark Mode"
                        value="dark"
                        // iconType="check"
                    >
                        <RiMoonLine
                            className="size-4 shrink-0"
                            aria-hidden="true"
                        />
                        Dark
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem
                        aria-label="Switch to System Mode"
                        value="system"
                        // iconType="check"
                    >
                        <RiComputerLine
                            className="size-4 shrink-0"
                            aria-hidden="true"
                        />
                        System
                    </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
