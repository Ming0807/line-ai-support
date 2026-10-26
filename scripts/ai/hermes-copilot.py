"""Hermes staff-copilot prototype with one parent-validated read-only tool.

This process can request supplemental knowledge search only. The parent binds
the original ticket question, checks authorization and source DTOs, and alone
decides whether the run qualifies as PROTOTYPE_SMOKE_ONLY.
"""
import json
import os
import sys
import urllib.request


def phase(name):
    print(f"YRU_HERMES_PHASE={name}", flush=True)


def search_knowledge(query):
    request = urllib.request.Request(
        os.environ["YRU_HERMES_TOOL_URL"],
        data=json.dumps({"query": query}).encode("utf-8"),
        headers={
            "authorization": "Bearer " + os.environ["YRU_HERMES_BRIDGE_TOKEN"],
            "content-type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def main():
    agent = None
    try:
        sys.path.insert(0, os.environ["YRU_HERMES_SOURCE"])
        phase("BEFORE_IMPORT")
        from toolsets import create_custom_toolset
        from tools.registry import registry
        from run_agent import AIAgent
        phase("AFTER_IMPORT")

        tool_name = "search_yru_knowledge"
        toolset = "yru_knowledge"
        phase("REGISTER_TOOL")
        registry.register(
            name=tool_name,
            toolset=toolset,
            schema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Supplemental search query; it cannot replace the bound ticket question.",
                    }
                },
                "required": ["query"],
                "additionalProperties": False,
            },
            handler=search_knowledge,
            description="Search published YRU knowledge for supplemental context (read-only).",
        )
        create_custom_toolset(toolset, "YRU published knowledge search (read-only)", [tool_name])

        phase("AGENT_INIT")
        agent = AIAgent(
            model="yru-free-pilot",
            provider="custom",
            api_mode="chat_completions",
            base_url=os.environ["YRU_HERMES_BRIDGE_URL"],
            api_key=os.environ["YRU_HERMES_BRIDGE_TOKEN"],
            enabled_toolsets=[toolset],
            max_iterations=4,
            run_budget_seconds=120,
            quiet_mode=True,
            verbose_logging=False,
            save_trajectories=False,
            skip_context_files=True,
            skip_memory=True,
            skip_background_review=True,
            load_soul_identity=False,
            session_db=None,
            checkpoints_enabled=False,
            max_tokens=2000,
        )
        phase("AGENT_READY")
        surface = []
        for tool in getattr(agent, "tools", []) or []:
            if isinstance(tool, dict):
                surface.append(str((tool.get("function") or {}).get("name") or tool.get("name") or tool))
            else:
                surface.append(str(getattr(tool, "name", tool)))
        if surface != [tool_name]:
            raise RuntimeError("PILOT_TOOL_SURFACE_INVALID")

        phase("TURN_1_START")
        result = agent.run_conversation(
            user_message=(
                "Prepare an unreviewed staff draft for the original bound student question in the system context. "
                "Call the supplemental knowledge search tool once. Its query must not replace the bound question. "
                "Use only returned VERIFIED advice and source DTOs; do not send or publish anything."
            )
        )
        if not isinstance(result, dict) or result.get("completed") is not True or result.get("failed") is not False:
            raise RuntimeError("PILOT_TURN_FAILED")
        answer = result.get("final_response")
        if not isinstance(answer, str) or not answer.strip():
            raise RuntimeError("PILOT_EMPTY_REPLY")

        # This marker means only that Hermes completed a turn. The parent checks
        # actual successful tool use and VERIFIED source DTOs before smoke PASS.
        phase("TURN_1_DONE")
        print("YRU_PILOT_TURN_COMPLETE", flush=True)
        return 0
    except Exception:
        print("YRU_PILOT_FAILURE", file=sys.stderr, flush=True)
        return 1
    finally:
        if agent is not None:
            try:
                agent.close()
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
