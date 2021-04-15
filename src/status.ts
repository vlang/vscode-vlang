import { StatusBarAlignment, StatusBarItem, ThemeColor, window } from "vscode";

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

	errorColor = new ThemeColor("statusBarItem.errorBackground");
	lastResult = FormatterStatus.Ready;
	didAutoShow = false;
	enableAutoShow = false;
	/**
	 * Update the statusBarItem message and show the statusBarItem
	 *
	 * @param icon The the icon to use
	 */
	public update(result: FormatterStatus): void {
		this.statusBarItem.text = `$(${result.toString()}) v fmt`;
		if (result === FormatterStatus.Error) {
			this.statusBarItem.backgroundColor = this.errorColor;
		} else {
			this.statusBarItem.backgroundColor = null;
		}
		this.statusBarItem.show();

		if (this.enableAutoShow) {
			if (
				this.lastResult === FormatterStatus.Error &&
				result === FormatterStatus.Success
			) {
				outputChannel.hide();
				this.didAutoShow = false;
			} else if (result === FormatterStatus.Error && !this.didAutoShow) {
				outputChannel.show(true);
				this.didAutoShow = true;
			}
		}

		if (result === FormatterStatus.Success) {
			this.didAutoShow = false;
		}

		this.lastResult = result;
	}

	public hide() {
		this.statusBarItem.hide();
	}
}

export const statusBar = new StatusBar();
