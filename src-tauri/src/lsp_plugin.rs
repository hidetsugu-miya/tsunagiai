//! #1242 (a part of A-34 and A-45): what gives a Claude Code that sets up the language servers of a project its tools: the plugin `lsp`, and the requests of its tools that a PC other than the app's pushes to the app.
//! The plugin is the files of `src-tauri/lsp-plugin/` that `build.rs` embeds (`formation_assets::LSP_PLUGIN`) and an `.mcp.json` that names the `tsunagiai-mcp` of the PC the Claude Code runs on. It is written into `lsp-plugin/` of that PC's config folder as `preview_plugin` writes its own: by the app for its own PC, and by `tsunagiai-mcp --lsp-plugin` for the PC of a saved environment.
//! The `.mcp.json` differs by PC. On the app's PC it starts `tsunagiai-mcp --lsp-local`, whose tools read and write `lsp-settings.json` of this PC. On the PC of a saved environment it starts `tsunagiai-mcp --lsp`, whose tools write nothing there: each pushes its request to the app (`push.sock`, A-37), which keeps the settings of that environment, and it never falls back to this PC's file (it would write the settings of another PC).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    formation_assets::{ensure_plugin, LSP_PLUGIN},
    formation_server::PushRequest,
    lsp::{self, LspServerSettings},
};

/// The folder of the plugin in the config folder.
const FOLDER: &str = "lsp-plugin";
/// The argument that `.mcp.json` gives `tsunagiai-mcp` on the PC of a saved environment: the tools push their requests to the app.
pub const ARG: &str = "--lsp";
/// The argument that `.mcp.json` gives `tsunagiai-mcp` on the app's own PC: the tools read and write the settings of this PC, and `lsp_repo_ssh_host_set` is one of them.
pub const LOCAL_ARG: &str = "--lsp-local";
/// The argument of `tsunagiai-mcp` that writes the plugin for a saved environment's PC and prints the folder's path (one line on stdout), and serves nothing.
pub const FLAG: &str = "--lsp-plugin";

/// `lsp-plugin/` in the config directory.
pub fn plugin_dir(config: &Path) -> PathBuf {
    config.join(FOLDER)
}

/// Makes `lsp-plugin/` of `config` hold the embedded plugin and the `.mcp.json` that starts `mcp` (the `tsunagiai-mcp` of this PC, an absolute path) with `--lsp-local` when `local` (the app's own PC) and with `--lsp` otherwise, and answers its path. A folder that holds this very plugin, for this `mcp` and this argument, is left as it is.
pub fn write_plugin(config: &Path, mcp: &Path, local: bool) -> Result<PathBuf, String> {
    let dir = plugin_dir(config);
    let mcp_json = crate::claude_code::mcp_config(mcp, &[if local { LOCAL_ARG } else { ARG }]);
    let mut files = LSP_PLUGIN.to_vec();
    files.push((".mcp.json", &mcp_json));
    ensure_plugin(&dir, &files)?;
    Ok(dir)
}

/// Whether `--lsp-plugin` is among `args`: `tsunagiai-mcp` then writes the plugin for a saved environment's PC and serves nothing.
pub fn requested(args: impl IntoIterator<Item = String>) -> bool {
    args.into_iter().any(|arg| arg == FLAG)
}

// ---- the requests of the tools ----

/// The methods of the pushes. The environment is in none of their params: the app takes it from the connection the push came through. `lsp_repo_ssh_host_set` has no method: a Host of `~/.ssh/config` is of the app's PC, and the owner chooses it on the screen (#1242).
pub const SETTINGS_METHOD: &str = "lsp.settings";
pub const SAVE_METHOD: &str = "lsp.server_save";
pub const DELETE_METHOD: &str = "lsp.server_delete";
const UNREADABLE_REQUEST: &str = "依頼を読めませんでした";

#[derive(Serialize, Deserialize)]
struct ProjectParams {
    project: String,
}

#[derive(Serialize, Deserialize)]
struct SaveParams {
    project: String,
    server: LspServerSettings,
}

#[derive(Serialize, Deserialize)]
struct DeleteParams {
    project: String,
    language: String,
}

fn push<T: Serialize>(method: &str, params: &T) -> Result<PushRequest, String> {
    Ok(PushRequest {
        method: method.to_owned(),
        params: serde_json::to_value(params).map_err(|e| e.to_string())?,
    })
}

/// The push that asks for the settings of `project`.
pub fn settings_push(project: &str) -> Result<PushRequest, String> {
    push(
        SETTINGS_METHOD,
        &ProjectParams {
            project: project.to_owned(),
        },
    )
}

/// The push that asks to save `server` in the settings of `project`.
pub fn save_push(project: &str, server: LspServerSettings) -> Result<PushRequest, String> {
    push(
        SAVE_METHOD,
        &SaveParams {
            project: project.to_owned(),
            server,
        },
    )
}

/// The push that asks to delete the server of `language` from the settings of `project`.
pub fn delete_push(project: &str, language: &str) -> Result<PushRequest, String> {
    push(
        DELETE_METHOD,
        &DeleteParams {
            project: project.to_owned(),
            language: language.to_owned(),
        },
    )
}

/// What a push of the three methods asks, as the app reads it.
#[derive(Debug, PartialEq)]
pub enum LspPush {
    Settings {
        project: String,
    },
    Save {
        project: String,
        server: LspServerSettings,
    },
    Delete {
        project: String,
        language: String,
    },
}

impl LspPush {
    /// `None` when `request` is not one of the three methods (the app's other handlers decide it), else what it asks, or the reason it cannot be read. Params that a PC adds (an `environment`, say) are not read: the environment is the connection's.
    pub fn of(request: &PushRequest) -> Option<Result<Self, String>> {
        let params = request.params.clone();
        let unreadable = |_| UNREADABLE_REQUEST.to_owned();
        match request.method.as_str() {
            SETTINGS_METHOD => Some(
                serde_json::from_value::<ProjectParams>(params)
                    .map(|p| Self::Settings { project: p.project })
                    .map_err(unreadable),
            ),
            SAVE_METHOD => Some(
                serde_json::from_value::<SaveParams>(params)
                    .map(|p| Self::Save {
                        project: p.project,
                        server: p.server,
                    })
                    .map_err(unreadable),
            ),
            DELETE_METHOD => Some(
                serde_json::from_value::<DeleteParams>(params)
                    .map(|p| Self::Delete {
                        project: p.project,
                        language: p.language,
                    })
                    .map_err(unreadable),
            ),
            _ => None,
        }
    }

    /// Does it for the project of the saved environment `environment` (the one of the connection) with the functions of `lsp.rs` that the app's own save uses, so every check of a save applies, and answers the settings as saved.
    pub fn run(self, config: &Path, environment: &str) -> Result<Value, String> {
        let environment = Some(environment);
        let saved = match self {
            Self::Settings { project } => lsp::read_settings(config, environment, &project),
            Self::Save { project, server } => {
                lsp::save_server(config, environment, &project, server)
            }
            Self::Delete { project, language } => {
                lsp::delete_server(config, environment, &project, &language)
            }
        }?;
        serde_json::to_value(saved).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tsunagiai-lsp-plugin-{}-{name}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn server(language: &str) -> LspServerSettings {
        LspServerSettings {
            language: language.to_owned(),
            name: "rust-analyzer".to_owned(),
            auto_start: true,
            command: Some("rust-analyzer".to_owned()),
            mount: None,
            service: None,
        }
    }

    #[test]
    fn the_plugin_is_embedded_with_its_manifest_and_skill_and_no_server_of_its_own() {
        let paths: Vec<&str> = LSP_PLUGIN.iter().map(|(path, _)| *path).collect();
        assert_eq!(paths, [".claude-plugin/plugin.json", "skills/lsp/SKILL.md"]);
        let manifest: serde_json::Value = serde_json::from_str(LSP_PLUGIN[0].1).unwrap();
        assert_eq!(manifest["name"], "lsp");
        assert!(manifest["description"]
            .as_str()
            .is_some_and(|d| !d.is_empty()));
        let skill = LSP_PLUGIN[1].1;
        assert!(skill.starts_with("---\nname: lsp\ndescription: "));
        for word in [
            "lsp_settings",
            "lsp_server_save",
            "lsp_server_delete",
            "lsp_repo_ssh_host_set",
            "data",
        ] {
            assert!(skill.contains(word), "{word}");
        }
    }

    #[test]
    fn the_plugin_is_written_whole_and_its_mcp_json_names_the_argument_of_the_pc() {
        let mcp = Path::new("/Applications/tsunagiai.app/Contents/MacOS/tsunagiai-mcp");
        for (local, arg) in [(true, "--lsp-local"), (false, "--lsp")] {
            let config = temp_dir(if local { "local" } else { "pushed" });
            let dir = write_plugin(&config, mcp, local).unwrap();
            assert_eq!(dir, config.join("lsp-plugin"));
            for (path, text) in LSP_PLUGIN {
                assert_eq!(&std::fs::read_to_string(dir.join(path)).unwrap(), text);
            }
            let json: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(dir.join(".mcp.json")).unwrap())
                    .unwrap();
            assert_eq!(
                json,
                serde_json::json!({"mcpServers": {"tsunagiai": {
                    "command": "/Applications/tsunagiai.app/Contents/MacOS/tsunagiai-mcp",
                    "args": [arg]
                }}})
            );
            let names: Vec<_> = std::fs::read_dir(&config)
                .unwrap()
                .map(|e| e.unwrap().file_name())
                .collect();
            assert_eq!(names, ["lsp-plugin"]);
            std::fs::remove_dir_all(config).unwrap();
        }
    }

    #[test]
    fn a_folder_that_holds_this_plugin_is_left_and_one_for_another_server_or_argument_is_written_again(
    ) {
        let config = temp_dir("again");
        let mcp = Path::new("/a/tsunagiai-mcp");
        let dir = write_plugin(&config, mcp, false).unwrap();
        std::fs::write(dir.join("marker.txt"), "x").unwrap();
        write_plugin(&config, mcp, false).unwrap();
        assert!(dir.join("marker.txt").exists());
        write_plugin(&config, mcp, true).unwrap();
        assert!(!dir.join("marker.txt").exists());
        assert!(std::fs::read_to_string(dir.join(".mcp.json"))
            .unwrap()
            .contains("--lsp-local"));
        std::fs::write(dir.join("marker.txt"), "x").unwrap();
        write_plugin(&config, Path::new("/b/tsunagiai-mcp"), true).unwrap();
        assert!(!dir.join("marker.txt").exists());
        std::fs::remove_dir_all(config).unwrap();
    }

    #[test]
    fn the_flag_is_found_among_the_arguments_and_nowhere_else() {
        let args = |list: &[&str]| list.iter().map(|a| (*a).to_owned()).collect::<Vec<_>>();
        assert!(requested(args(&["--lsp-plugin"])));
        assert!(requested(args(&["--calendar", "--lsp-plugin"])));
        assert!(!requested(args(&[])));
        for none in [
            &["--lsp"][..],
            &["--lsp-local"],
            &["--preview-plugin"],
            &["--lsp-plugin-x"],
        ] {
            assert!(!requested(args(none)), "{none:?}");
        }
    }

    #[test]
    fn a_push_is_built_and_read_back_and_carries_no_environment() {
        let settings = settings_push("repo-1").unwrap();
        assert_eq!(settings.method, "lsp.settings");
        assert_eq!(settings.params, serde_json::json!({"project": "repo-1"}));
        assert_eq!(
            LspPush::of(&settings),
            Some(Ok(LspPush::Settings {
                project: "repo-1".into()
            }))
        );
        let save = save_push("repo-1", server("rust")).unwrap();
        assert_eq!(save.method, "lsp.server_save");
        assert_eq!(save.params["server"]["autoStart"], true);
        assert_eq!(
            LspPush::of(&save),
            Some(Ok(LspPush::Save {
                project: "repo-1".into(),
                server: server("rust")
            }))
        );
        let delete = delete_push("repo-1", "rust").unwrap();
        assert_eq!(
            delete.params,
            serde_json::json!({"project": "repo-1", "language": "rust"})
        );
        assert_eq!(
            LspPush::of(&delete),
            Some(Ok(LspPush::Delete {
                project: "repo-1".into(),
                language: "rust".into()
            }))
        );
    }

    #[test]
    fn a_push_of_another_method_is_not_this_ones_and_an_unreadable_one_is_refused_with_fixed_words()
    {
        let other = |method: &str| PushRequest {
            method: method.to_owned(),
            params: Value::Null,
        };
        for method in ["preview.open", "lsp.ssh_host_set", "lsp.settings.x", ""] {
            assert_eq!(LspPush::of(&other(method)), None, "{method}");
        }
        for method in [SETTINGS_METHOD, SAVE_METHOD, DELETE_METHOD] {
            assert_eq!(
                LspPush::of(&other(method)),
                Some(Err("依頼を読めませんでした".to_owned())),
                "{method}"
            );
        }
    }

    #[test]
    fn a_push_works_on_the_environment_it_is_given_and_ignores_one_in_its_params() {
        let config = temp_dir("run");
        let mut request = save_push("repo-1", server("rust")).unwrap();
        request.params["environment"] = serde_json::json!("another-pc");
        let saved = LspPush::of(&request)
            .unwrap()
            .unwrap()
            .run(&config, "pc-a")
            .unwrap();
        assert_eq!(saved["environment"], "pc-a");
        assert_eq!(saved["project"], "repo-1");
        assert_eq!(saved["servers"][0]["language"], "rust");
        let read = LspPush::of(&settings_push("repo-1").unwrap())
            .unwrap()
            .unwrap();
        assert_eq!(read.run(&config, "pc-a").unwrap(), saved);
        // Another environment has nothing saved, and this machine's settings are untouched.
        let other = LspPush::of(&settings_push("repo-1").unwrap())
            .unwrap()
            .unwrap();
        assert_eq!(
            other.run(&config, "pc-b").unwrap()["servers"],
            serde_json::json!([])
        );
        assert_eq!(
            lsp::read_settings(&config, None, "repo-1").unwrap().servers,
            []
        );
        let deleted = LspPush::of(&delete_push("repo-1", "rust").unwrap())
            .unwrap()
            .unwrap();
        assert_eq!(
            deleted.run(&config, "pc-a").unwrap()["servers"],
            serde_json::json!([])
        );
        let missing = LspPush::of(&delete_push("repo-1", "rust").unwrap())
            .unwrap()
            .unwrap();
        assert!(missing.run(&config, "pc-a").is_err());
        std::fs::remove_dir_all(config).unwrap();
    }
}
