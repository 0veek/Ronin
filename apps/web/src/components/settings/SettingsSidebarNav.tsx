import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeftIcon, SearchIcon, XIcon } from "lucide-react";
import { useCanGoBack, useLocation, useNavigate } from "@tanstack/react-router";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../ui/sidebar";
import { scrollToSettingsTarget } from "./settingsLayout";
import { SETTINGS_NAV_GROUPS, SETTINGS_PAGE_META } from "./settingsNavigation";
import { searchSettings, type SettingsPath, type SettingsSearchItem } from "./settingsSearch";

function SettingsSectionIcon({ to }: { to: SettingsPath }) {
  const Icon = SETTINGS_PAGE_META[to].icon;
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-[var(--control-radius)] border border-sidebar-border bg-sidebar-control-surface text-sidebar-muted-foreground">
      <Icon className="size-3.5" />
    </span>
  );
}

export function SettingsSidebarNav({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  const currentHash = useLocation({ select: (location) => location.hash });
  const canGoBack = useCanGoBack();
  const { isMobile, setOpenMobile, open, setOpen } = useSidebar();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const results = useMemo(() => searchSettings(query), [query]);
  const isSearching = query.trim().length > 0;
  const hasResults = results.length > 0;

  useEffect(() => {
    const result = results[activeResultIndex];
    if (!result) return;
    document
      .getElementById(`settings-search-result-${result.id}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeResultIndex, results]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          // Keep focus inside open dialogs and popups instead of escaping
          // their focus trap into the sidebar search.
          target.closest('[role="dialog"], [aria-modal="true"], [data-slot$="popup"]') !== null)
      ) {
        return;
      }

      event.preventDefault();
      if (isMobile) {
        setOpenMobile(true);
      } else if (!open) {
        setOpen(true);
      }
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobile, open, setOpen, setOpenMobile]);

  const handleSectionClick = useCallback(
    (to: SettingsPath) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      void navigate({ to, hash: "", replace: true, hashScrollIntoView: false });
    },
    [isMobile, navigate, setOpenMobile],
  );
  const clearSearch = useCallback(() => {
    setQuery("");
    setActiveResultIndex(0);
  }, []);
  const handleSearchResultClick = useCallback(
    (item: SettingsSearchItem) => {
      clearSearch();
      if (isMobile) {
        setOpenMobile(false);
      }
      const targetId = item.targetId ?? item.id;
      if (pathname === item.to && currentHash.replace(/^#/, "") === targetId) {
        scrollToSettingsTarget(targetId);
        return;
      }
      void navigate({ to: item.to, hash: targetId, replace: true, hashScrollIntoView: false });
    },
    [clearSearch, currentHash, isMobile, navigate, pathname, setOpenMobile],
  );
  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape" && isSearching) {
        event.preventDefault();
        event.stopPropagation();
        clearSearch();
        return;
      }
      if (results.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveResultIndex((index) => (index + 1) % results.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveResultIndex((index) => (index - 1 + results.length) % results.length);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const result = results[activeResultIndex];
        if (result) handleSearchResultClick(result);
      }
    },
    [activeResultIndex, clearSearch, handleSearchResultClick, isSearching, results],
  );
  const handleBackClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    if (canGoBack) {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  }, [canGoBack, isMobile, navigate, setOpenMobile]);

  return (
    <>
      <SidebarContent
        className="gap-0 overflow-x-hidden"
        fixedHeader={
          <SidebarGroup className="border-b border-sidebar-border p-[var(--sidebar-content-inset)]">
            <div className="flex h-9 items-center gap-2 rounded-[var(--control-radius)] border border-sidebar-border bg-sidebar-control-surface/65 px-2.5 text-sidebar-muted-foreground transition-colors focus-within:border-sidebar-muted-foreground/50 focus-within:bg-sidebar-control-surface focus-within:text-sidebar-foreground focus-within:ring-1 focus-within:ring-ring/30">
              <SearchIcon className="size-4 shrink-0" />
              <Input
                ref={searchInputRef}
                nativeInput
                unstyled
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  setActiveResultIndex(0);
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search settings…"
                aria-label="Search settings"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={isSearching && hasResults}
                aria-controls={isSearching && hasResults ? "settings-search-results" : undefined}
                aria-activedescendant={
                  isSearching && results[activeResultIndex]
                    ? `settings-search-result-${results[activeResultIndex].id}`
                    : undefined
                }
                className="min-w-0 flex-1 [&_[data-slot=input]]:h-auto [&_[data-slot=input]]:p-0 [&_[data-slot=input]]:leading-normal [&_[data-slot=input]]:text-sm [&_[data-slot=input]]:font-medium [&_[data-slot=input]]:text-sidebar-foreground [&_[data-slot=input]]:placeholder:text-sidebar-muted-foreground/70"
              />
              {isSearching ? (
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  className="size-5 shrink-0 rounded-sm text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                  aria-label="Clear settings search"
                  onClick={() => {
                    clearSearch();
                    searchInputRef.current?.focus();
                  }}
                >
                  <XIcon className="size-3" />
                </Button>
              ) : (
                <Kbd className="h-4 min-w-0 rounded-sm px-1.5 text-2xs">/</Kbd>
              )}
            </div>
          </SidebarGroup>
        }
      >
        {isSearching ? (
          <SidebarGroup className="gap-1 px-[var(--sidebar-content-inset)] pt-2 pb-3">
            <SidebarGroupLabel className="h-6 px-2">
              {hasResults
                ? `${results.length} result${results.length === 1 ? "" : "s"}`
                : "Results"}
            </SidebarGroupLabel>
            {isSearching && results.length === 0 ? (
              <p
                role="status"
                className="px-3 py-8 text-center text-xs leading-5 text-sidebar-muted-foreground"
              >
                No settings match “{query.trim()}”
              </p>
            ) : null}
            <SidebarMenu
              className="gap-px ps-px"
              id={isSearching && hasResults ? "settings-search-results" : undefined}
              role={isSearching && hasResults ? "listbox" : undefined}
              aria-label={isSearching && hasResults ? "Settings search results" : undefined}
            >
              {results.map((item, index) => (
                <SidebarMenuItem key={item.id} role="presentation">
                  <SidebarMenuButton
                    id={`settings-search-result-${item.id}`}
                    role="option"
                    aria-selected={index === activeResultIndex}
                    tabIndex={-1}
                    size="sm"
                    isActive={index === activeResultIndex}
                    className="h-auto min-h-11 items-start gap-2.5 rounded-[var(--control-radius)] px-2 py-2 text-left hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                    onMouseMove={() => setActiveResultIndex(index)}
                    onClick={() => handleSearchResultClick(item)}
                  >
                    <SettingsSectionIcon to={item.to} />
                    <div className="min-w-0 flex-1 pt-px">
                      <span className="block truncate text-sm font-medium text-sidebar-foreground">
                        {item.title}
                      </span>
                      <span className="mt-0.5 block truncate text-2xs text-sidebar-muted-foreground/75">
                        {SETTINGS_PAGE_META[item.to].label}
                      </span>
                    </div>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ) : (
          SETTINGS_NAV_GROUPS.map((group) => (
            <SidebarGroup
              key={group.label}
              className="gap-1 px-[var(--sidebar-content-inset)] pt-2 pb-1"
            >
              <SidebarGroupLabel className="h-6 px-2">{group.label}</SidebarGroupLabel>
              <SidebarMenu className="gap-px ps-px">
                {group.paths.map((to) => {
                  const meta = SETTINGS_PAGE_META[to];
                  const Icon = meta.icon;
                  const isActive = pathname === to || pathname.startsWith(`${to}/`);
                  return (
                    <SidebarMenuItem key={to}>
                      <SidebarMenuButton
                        isActive={isActive}
                        className="sidebar-row h-auto min-h-11 items-start gap-2.5 rounded-[var(--control-radius)] px-2 py-2"
                        onClick={() => handleSectionClick(to)}
                      >
                        <Icon className="mt-0.5 size-4" />
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-sm leading-4">{meta.label}</span>
                          <span className="mt-1 block truncate text-2xs leading-3.5 font-normal text-sidebar-muted-foreground/65">
                            {meta.description}
                          </span>
                        </div>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
          ))
        )}
      </SidebarContent>
      <SidebarFooter className="gap-0 border-t border-sidebar-border p-[var(--sidebar-content-inset)]">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton className="justify-between" onClick={handleBackClick}>
              <span className="flex min-w-0 items-center gap-2">
                <ArrowLeftIcon />
                <span>Back to workspace</span>
              </span>
              <Kbd className="h-4 min-w-0 rounded-sm px-1.5 text-2xs">Esc</Kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}
