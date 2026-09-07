import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { Dropdown, DropdownGroup } from "@/components/create/Dropdown";

jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return new Proxy({}, { get: () => () => React.createElement(React.Fragment) });
});

const OPTIONS = [
  { value: "short", label: "Short" },
  { value: "standard", label: "Standard" },
  { value: "long", label: "Long" },
];

function SingleDropdown({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = React.useState("standard");
  return (
    <Dropdown
      id="length"
      label="Chapter length"
      value={value}
      options={OPTIONS}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      testID="length-dropdown"
    />
  );
}

function TwoDropdowns() {
  const [a, setA] = React.useState("short");
  const [b, setB] = React.useState("English");
  return (
    <DropdownGroup>
      <Dropdown
        id="a"
        label="Chapters"
        value={a}
        options={[
          { value: "short", label: "3" },
          { value: "long", label: "15" },
        ]}
        onChange={setA}
        testID="dropdown-a"
      />
      <Dropdown
        id="b"
        label="Language"
        value={b}
        options={[{ value: "English", label: "English" }]}
        onChange={setB}
        testID="dropdown-b"
      />
    </DropdownGroup>
  );
}

describe("Dropdown", () => {
  it("closes on outside tap and leaves the committed selection unchanged", async () => {
    const onChange = jest.fn();
    const view = await render(<SingleDropdown onChange={onChange} />);

    const trigger = view.getByRole("button", { name: "Chapter length" });
    expect(trigger.props.accessibilityValue).toEqual({ text: "Standard" });

    await fireEvent.press(trigger);
    expect(view.getByRole("button", { name: "Long" })).toBeTruthy();

    // Tapping the scrim (outside the menu) closes it without picking anything.
    // The scrim is deliberately hidden from the accessibility tree (see the
    // component), so it must be found with includeHiddenElements here.
    await fireEvent.press(
      view.getByTestId("length-dropdown-scrim", { includeHiddenElements: true }),
    );

    expect(view.queryByRole("button", { name: "Long" })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(
      view.getByRole("button", { name: "Chapter length" }).props.accessibilityValue,
    ).toEqual({ text: "Standard" });
  });

  it("commits the chosen option and closes", async () => {
    const onChange = jest.fn();
    const view = await render(<SingleDropdown onChange={onChange} />);

    await fireEvent.press(view.getByRole("button", { name: "Chapter length" }));
    await fireEvent.press(view.getByRole("button", { name: "Long" }));

    expect(onChange).toHaveBeenCalledWith("long");
    expect(view.queryByRole("button", { name: "Long" })).toBeNull();
    expect(
      view.getByRole("button", { name: "Chapter length" }).props.accessibilityValue,
    ).toEqual({ text: "Long" });
  });

  it("opening a second dropdown in the same group closes the first", async () => {
    const view = await render(<TwoDropdowns />);

    await fireEvent.press(view.getByRole("button", { name: "Chapters" }));
    expect(view.getByRole("button", { name: "15" })).toBeTruthy();

    await fireEvent.press(view.getByRole("button", { name: "Language" }));

    // The Chapters menu's "15" option is gone -- opening Language closed it.
    expect(view.queryByRole("button", { name: "15" })).toBeNull();
    expect(view.getByRole("button", { name: "English" })).toBeTruthy();
  });
});
