import { StatusBarAlignment, StatusBarItem, window } from "vscode";

export const outputChannel = window.createOutputChannel("V");

export enum FormatterStatus {
	Ready = "check-all",
	Success = "check",
	Ignore = "x",
	Error = "alert",
	Disabled = "circle-slash",
}

// Thank you Prettier!
export class StatusBar {
	private statusBarItem: StatusBarItem;
	constructor() {
		// Setup the statusBarItem
		this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, -1);
		this.statusBarItem.text = "v fmt";
		this.statusBarItem.command = "v.openOutput";
		this.update(FormatterStatus.Ready);
		this.statusBarItem.show();
	}

	/**
	 * Update the statusBarItem message and show the statusBarItem
	 *
	 * @param icon The the icon to use
	 */
	public update(result: FormatterStatus): void {
		this.statusBarItem.text = `$(${result.toString()}) v fmt`;
		// Waiting for VS Code 1.53: https://github.com/microsoft/vscode/pull/116181
		// if (result === FormattingResult.Error) {
		//   this.statusBarItem.backgroundColor = new ThemeColor(
		//     "statusBarItem.errorBackground"
		//   );
		// } else {
		//   this.statusBarItem.backgroundColor = new ThemeColor(
		//     "statusBarItem.fourgroundBackground"
		//   );
		// }
		this.statusBarItem.show();
	}

	public hide() {
		this.statusBarItem.hide();
	}
}

export const statusBar = new StatusBar();
