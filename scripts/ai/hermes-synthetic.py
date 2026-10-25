"""Two synthetic turns only; no LINE input or provider credentials enter Hermes."""
import faulthandler
import os
import sys

def phase(name):
    print(f"YRU_HERMES_PHASE={name}", flush=True)

trace_path = os.environ.get("YRU_HERMES_TRACEBACK")
trace_file = open(trace_path, "w", encoding="utf-8") if trace_path else None
if trace_file:
    # Stack frames only, with no locals or request/provider values.
    faulthandler.dump_traceback_later(30, file=trace_file, repeat=False)

sys.path.insert(0, os.environ["YRU_HERMES_SOURCE"])
phase("BEFORE_IMPORT")
from run_agent import AIAgent
phase("AFTER_IMPORT")

phase("AGENT_INIT")
agent = AIAgent(
    model="yru-free-pilot",
    provider="custom",
    api_mode="chat_completions",
    base_url=os.environ["YRU_HERMES_BRIDGE_URL"],
    api_key=os.environ["YRU_HERMES_BRIDGE_TOKEN"],
    enabled_toolsets=[],
    max_iterations=1,
    run_budget_seconds=45,
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
try:
    # Fail closed if upstream's empty allowlist ever exposes a tool.
    if getattr(agent, "tools", []):
        raise RuntimeError("PILOT_UNEXPECTED_TOOLS")
    history = None
    for index, prompt in enumerate(["สวัสดี ช่วยอธิบายว่า Wi-Fi คืออะไรแบบเข้าใจง่ายหน่อย", "ช่วยย่อคำตอบเมื่อกี้เป็นหนึ่งประโยค"], 1):
        phase(f"TURN_{index}_START")
        result = agent.run_conversation(user_message=prompt, conversation_history=history)
        if result.get("completed") is not True or result.get("failed") is not False:
            raise RuntimeError("PILOT_TURN_FAILED")
        answer = result.get("final_response", "")
        if not isinstance(answer, str) or not answer.strip():
            raise RuntimeError("PILOT_EMPTY_REPLY")
        print("YRU_PILOT_TURN_COMPLETE", flush=True)
        history = result["messages"]
        phase(f"TURN_{index}_DONE")
finally:
    agent.close()
    if trace_file:
        faulthandler.cancel_dump_traceback_later()
        trace_file.close()
