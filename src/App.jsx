import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import logo from "./assets/progresspoint-logo.png";
import { auth, db, storage } from "./firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  collection,
  addDoc,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy,
  doc,
  updateDoc,
  deleteDoc,
  setDoc,
  getDoc,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

// ─── Small pure components ────────────────────────────────────────────────────

const ReportBar = ({ label, value, total }) => {
  const percent = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="report-bar">
      <div>
        <strong>{label}</strong>
        <span>
          {value} tasks • {percent}%
        </span>
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
};

const NavButton = ({ page, activePage, setActivePage }) => (
  <button
    className={activePage === page ? "active" : ""}
    onClick={() => setActivePage(page)}
  >
    {page}
  </button>
);

const TaskFilters = ({ searchTerm, setSearchTerm, statusFilter, setStatusFilter }) => (
  <div className="filters-row">
    <input
      type="text"
      placeholder="Search tasks, clients, people..."
      value={searchTerm}
      onChange={(e) => setSearchTerm(e.target.value)}
    />
    <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
      <option value="All">All</option>
      <option value="Pending">Pending</option>
      <option value="In Progress">In Progress</option>
      <option value="Completed">Completed</option>
    </select>
  </div>
);

const TaskTable = ({ visibleTasks, canDeleteTasks, updateTaskStatus, deleteTask, setSelectedTask }) => (
  <div className="task-table-wrapper">
    <table className="task-table">
      <thead>
        <tr>
          <th>Task</th>
          <th>Client</th>
          <th>Assigned To</th>
          <th>Deadline</th>
          <th>Priority</th>
          <th>Status</th>
          <th>Files</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {visibleTasks.length === 0 ? (
          <tr>
            <td colSpan="8" className="empty-table">
              No tasks found.
            </td>
          </tr>
        ) : (
          visibleTasks.map((task) => (
            <tr key={task.id}>
              <td>
                <strong>{task.title || "Untitled task"}</strong>
                <small>Created by {task.createdBy || "Unknown"}</small>
              </td>
              <td>{task.clientName || "Not added"}</td>
              <td>{task.assignedTo || "Not assigned"}</td>
              <td
                className={
                  new Date(task.deadline + "T23:59:59") < new Date() &&
                  task.status !== "Completed"
                    ? "overdue-text"
                    : ""
                }
              >
                {task.deadline || "No deadline"}
              </td>
              <td>
                <span className={`priority ${(task.priority || "Medium").toLowerCase()}`}>
                  {task.priority || "Medium"}
                </span>
              </td>
              <td>
                <select
                  className={`status-select ${(task.status || "Pending")
                    .toLowerCase()
                    .replace(" ", "-")}`}
                  value={task.status || "Pending"}
                  onChange={(e) => updateTaskStatus(task.id, e.target.value)}
                >
                  <option value="Pending">Pending</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Completed">Completed</option>
                </select>
              </td>
              <td>{(task.files || []).length}</td>
              <td className="action-cell">
                <button className="view-btn" onClick={() => setSelectedTask(task)}>
                  Open
                </button>
                {canDeleteTasks && (
                  <button className="delete-task-btn" onClick={() => deleteTask(task.id)}>
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);

// ─── Task Modal ───────────────────────────────────────────────────────────────

const TaskModal = ({
  selectedTask,
  setSelectedTask,
  tasks,
  uploadFileToTask,
  uploadingTaskId,
  commentText,
  setCommentText,
  addComment,
}) => {
  const fileInputRef = useRef(null);

  if (!selectedTask) return null;

  // Always read from live tasks so Firebase updates appear instantly
  const latestTask = tasks.find((t) => t.id === selectedTask.id) || selectedTask;

  return (
    <div className="modal-backdrop" onClick={() => setSelectedTask(null)}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="page-heading-row">
          <div>
            <h2>{latestTask.title}</h2>
            <p className="panel-subtitle">
              {latestTask.clientName} • Assigned to {latestTask.assignedTo}
            </p>
          </div>
          <button className="close-btn" onClick={() => setSelectedTask(null)}>
            Close
          </button>
        </div>

        <div className="detail-grid">
          <div><strong>Deadline</strong><span>{latestTask.deadline}</span></div>
          <div><strong>Priority</strong><span>{latestTask.priority}</span></div>
          <div><strong>Status</strong><span>{latestTask.status}</span></div>
          <div><strong>Created By</strong><span>{latestTask.createdBy}</span></div>
        </div>

        <div className="notes-box">
          <strong>Instructions</strong>
          <p>{latestTask.notes || "No notes added."}</p>
        </div>

        <div className="modal-section">
          <h3>Upload Work / Documents</h3>
          <input
            ref={fileInputRef}
            type="file"
            onChange={(e) => {
              const file = e.target.files[0];
              if (file) uploadFileToTask(latestTask, file, fileInputRef);
            }}
          />
          {uploadingTaskId === latestTask.id && (
            <p className="small-note">Uploading…</p>
          )}
          <div className="file-list">
            {(latestTask.files || []).length === 0 ? (
              <p className="empty-text">No files uploaded yet.</p>
            ) : (
              latestTask.files.map((file, index) => (
                <a key={index} href={file.url} target="_blank" rel="noreferrer">
                  {file.name}
                </a>
              ))
            )}
          </div>
        </div>

        <div className="modal-section">
          <h3>Comments</h3>
          <div className="comments-list">
            {(latestTask.comments || []).length === 0 ? (
              <p className="empty-text">No comments yet.</p>
            ) : (
              latestTask.comments.map((comment, index) => (
                <div className="comment-card" key={index}>
                  <strong>{comment.author} ({comment.role})</strong>
                  <p>{comment.text}</p>
                  <small>{new Date(comment.createdAt).toLocaleString()}</small>
                </div>
              ))
            )}
          </div>
          <div className="comment-form">
            <input
              placeholder="Write a comment or feedback..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
            />
            <button onClick={() => addComment(latestTask)}>Add Comment</button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Page components ──────────────────────────────────────────────────────────

const DashboardPage = ({
  visibleTasks, pendingTasks, progressTasks, completedTasks,
  canManageTasks, canDeleteTasks,
  taskTitle, setTaskTitle,
  clientName, setClientName,
  clients, users,
  assignedTo, setAssignedTo,
  deadline, setDeadline,
  priority, setPriority,
  taskNotes, setTaskNotes,
  addTask, userRole,
  searchTerm, setSearchTerm,
  statusFilter, setStatusFilter,
  updateTaskStatus, deleteTask, setSelectedTask, setActivePage,
}) => (
  <>
    <section className="stats-grid">
      <div className="stat-card"><span>Total Tasks</span><h2>{visibleTasks.length}</h2></div>
      <div className="stat-card"><span>Pending</span><h2>{pendingTasks}</h2></div>
      <div className="stat-card"><span>In Progress</span><h2>{progressTasks}</h2></div>
      <div className="stat-card"><span>Completed</span><h2>{completedTasks}</h2></div>
    </section>

    <section className="content-grid">
      <div className="panel">
        <h2>Create Accounting Task</h2>
        <p className="panel-subtitle">
          {canManageTasks
            ? "Assign work such as invoice capturing, payroll, tax filing, SARS work, and reconciliations."
            : "Only a Boss or Supervisor can create new tasks."}
        </p>

        <form onSubmit={addTask} className="task-form">
          <input
            type="text"
            placeholder="Task title e.g. Capture supplier invoices"
            value={taskTitle}
            disabled={!canManageTasks}
            onChange={(e) => setTaskTitle(e.target.value)}
          />
          <input
            type="text"
            placeholder="Client name"
            value={clientName}
            disabled={!canManageTasks}
            onChange={(e) => setClientName(e.target.value)}
            list="client-list"
          />
          <datalist id="client-list">
            {clients.map((client) => (
              <option key={client.id} value={client.name} />
            ))}
          </datalist>

          <select
            value={assignedTo}
            disabled={!canManageTasks}
            onChange={(e) => setAssignedTo(e.target.value)}
          >
            <option value="">Assign to intern/supervisor</option>
            {users.map((member) => (
              <option key={member.id} value={member.email}>
                {member.email} ({member.role})
              </option>
            ))}
          </select>

          <input
            type="date"
            value={deadline}
            disabled={!canManageTasks}
            onChange={(e) => setDeadline(e.target.value)}
          />

          <select
            value={priority}
            disabled={!canManageTasks}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
            <option value="Urgent">Urgent</option>
          </select>

          <textarea
            placeholder="Task notes / instructions"
            value={taskNotes}
            disabled={!canManageTasks}
            onChange={(e) => setTaskNotes(e.target.value)}
          />

          <button type="submit" disabled={!canManageTasks}>
            Create Task
          </button>
        </form>
      </div>

      <div className="panel">
        <h2>Your Access Level</h2>
        <p className="panel-subtitle">You are currently logged in as:</p>
        <div className="workflow-list">
          <div>
            <strong>{userRole}</strong>
            <span>
              {userRole === "Boss" && "Full access: create tasks, manage users, delete records, manage clients, and view reports."}
              {userRole === "Supervisor" && "Supervisor access: create tasks, monitor interns, manage clients, and view reports."}
              {userRole === "Intern" && "Intern access: view assigned tasks, upload work, comment, and update progress."}
            </span>
          </div>
          <div>
            <strong>Accounting Workflow</strong>
            <span>Invoices, reconciliations, payroll, tax, SARS tasks, audit prep, and reporting.</span>
          </div>
        </div>
      </div>
    </section>

    <section className="panel tasks-panel">
      <div className="page-heading-row">
        <div>
          <h2>Recent Tasks</h2>
          <p className="panel-subtitle">Latest tasks saved from Firebase.</p>
        </div>
        <button className="primary-btn" onClick={() => setActivePage("Tasks")}>
          View All Tasks
        </button>
      </div>
      <TaskFilters
        searchTerm={searchTerm} setSearchTerm={setSearchTerm}
        statusFilter={statusFilter} setStatusFilter={setStatusFilter}
      />
      <TaskTable
        visibleTasks={visibleTasks}
        canDeleteTasks={canDeleteTasks}
        updateTaskStatus={updateTaskStatus}
        deleteTask={deleteTask}
        setSelectedTask={setSelectedTask}
      />
    </section>
  </>
);

const TasksPage = ({
  visibleTasks, canManageTasks, canDeleteTasks,
  searchTerm, setSearchTerm, statusFilter, setStatusFilter,
  updateTaskStatus, deleteTask, setSelectedTask, setActivePage,
}) => (
  <section className="panel tasks-panel">
    <div className="page-heading-row">
      <div>
        <h2>All Tasks</h2>
        <p className="panel-subtitle">Update progress, monitor deadlines, upload work, and manage accounting tasks.</p>
      </div>
      {canManageTasks && (
        <button className="primary-btn" onClick={() => setActivePage("Dashboard")}>
          Create New Task
        </button>
      )}
    </div>
    <TaskFilters
      searchTerm={searchTerm} setSearchTerm={setSearchTerm}
      statusFilter={statusFilter} setStatusFilter={setStatusFilter}
    />
    <TaskTable
      visibleTasks={visibleTasks}
      canDeleteTasks={canDeleteTasks}
      updateTaskStatus={updateTaskStatus}
      deleteTask={deleteTask}
      setSelectedTask={setSelectedTask}
    />
  </section>
);

const InternsPage = ({ interns, tasks }) => (
  <section className="panel">
    <h2>Interns</h2>
    <p className="panel-subtitle">Intern profiles, assigned work, and performance.</p>
    <div className="people-grid">
      {interns.length === 0 ? (
        <p className="empty-text">No interns found yet.</p>
      ) : (
        interns.map((intern) => {
          const assigned = tasks.filter((t) => t.assignedTo === intern.email);
          const done = assigned.filter((t) => t.status === "Completed").length;
          return (
            <div className="person-card" key={intern.id}>
              <strong>{intern.email}</strong>
              <span>{intern.role}</span>
              <p>{assigned.length} assigned tasks</p>
              <p>{done} completed</p>
            </div>
          );
        })
      )}
    </div>
  </section>
);

const SupervisorsPage = ({ supervisors }) => (
  <section className="panel">
    <h2>Supervisors</h2>
    <p className="panel-subtitle">Supervisor profiles and review responsibility.</p>
    <div className="people-grid">
      {supervisors.length === 0 ? (
        <p className="empty-text">No supervisors found yet.</p>
      ) : (
        supervisors.map((supervisor) => (
          <div className="person-card" key={supervisor.id}>
            <strong>{supervisor.email}</strong>
            <span>{supervisor.role}</span>
            <p>Can create and monitor tasks</p>
          </div>
        ))
      )}
    </div>
  </section>
);

const ClientsPage = ({
  clients, clientForm, setClientForm,
  canManageClients, canDeleteTasks, addClient, deleteClient,
}) => (
  <section className="content-grid">
    <div className="panel">
      <h2>Add Client</h2>
      <p className="panel-subtitle">Create clients for accounting work.</p>
      <form className="task-form" onSubmit={addClient}>
        <input
          placeholder="Client name"
          value={clientForm.name}
          disabled={!canManageClients}
          onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })}
        />
        <input
          placeholder="Contact person"
          value={clientForm.contactPerson}
          disabled={!canManageClients}
          onChange={(e) => setClientForm({ ...clientForm, contactPerson: e.target.value })}
        />
        <input
          placeholder="Client email"
          value={clientForm.email}
          disabled={!canManageClients}
          onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })}
        />
        <input
          placeholder="Phone number"
          value={clientForm.phone}
          disabled={!canManageClients}
          onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })}
        />
        <select
          value={clientForm.service}
          disabled={!canManageClients}
          onChange={(e) => setClientForm({ ...clientForm, service: e.target.value })}
        >
          <option value="Monthly Accounting">Monthly Accounting</option>
          <option value="Payroll">Payroll</option>
          <option value="Tax Compliance">Tax Compliance</option>
          <option value="Audit Preparation">Audit Preparation</option>
          <option value="Bookkeeping">Bookkeeping</option>
        </select>
        <button disabled={!canManageClients}>Save Client</button>
      </form>
    </div>

    <div className="panel">
      <h2>Client List</h2>
      <p className="panel-subtitle">{clients.length} clients saved.</p>
      <div className="client-list">
        {clients.length === 0 ? (
          <p className="empty-text">No clients added yet.</p>
        ) : (
          clients.map((client) => (
            <div className="client-card" key={client.id}>
              <strong>{client.name}</strong>
              <span>{client.service}</span>
              <p>{client.contactPerson || "No contact person"}</p>
              <p>{client.email || "No email"} {client.phone ? `• ${client.phone}` : ""}</p>
              {canDeleteTasks && (
                <button className="delete-task-btn" onClick={() => deleteClient(client.id)}>
                  Delete
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  </section>
);

const AdminPage = ({ canManageUsers, users, changeUserRole }) => (
  <section className="panel">
    <h2>User Management</h2>
    <p className="panel-subtitle">Boss can change employees between Boss, Supervisor, and Intern.</p>
    {!canManageUsers ? (
      <p className="empty-text">Only the Boss can manage user roles.</p>
    ) : (
      <div className="task-table-wrapper">
        <table className="task-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Current Role</th>
              <th>Change Role</th>
            </tr>
          </thead>
          <tbody>
            {users.map((member) => (
              <tr key={member.id}>
                <td>{member.email}</td>
                <td>{member.role}</td>
                <td>
                  <select
                    className="role-select"
                    value={member.role || "Intern"}
                    onChange={(e) => changeUserRole(member.id, e.target.value)}
                  >
                    <option value="Boss">Boss</option>
                    <option value="Supervisor">Supervisor</option>
                    <option value="Intern">Intern</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </section>
);

const ReportsPage = ({ canSeeReports, overdueTasks, completedTasks, pendingTasks, progressTasks, visibleTasks }) => (
  <section className="panel">
    <h2>Reports</h2>
    {canSeeReports ? (
      <>
        <p className="panel-subtitle">Productivity, overdue work, completed tasks, and team overview.</p>
        <div className="stats-grid report-stats">
          <div className="stat-card"><span>Overdue</span><h2>{overdueTasks}</h2></div>
          <div className="stat-card"><span>Completed</span><h2>{completedTasks}</h2></div>
          <div className="stat-card"><span>Pending</span><h2>{pendingTasks}</h2></div>
          <div className="stat-card"><span>In Progress</span><h2>{progressTasks}</h2></div>
        </div>
        <div className="report-bars">
          <ReportBar label="Pending" value={pendingTasks} total={visibleTasks.length} />
          <ReportBar label="In Progress" value={progressTasks} total={visibleTasks.length} />
          <ReportBar label="Completed" value={completedTasks} total={visibleTasks.length} />
          <ReportBar label="Overdue" value={overdueTasks} total={visibleTasks.length} />
        </div>
      </>
    ) : (
      <p>Only a Boss or Supervisor can view reports.</p>
    )}
  </section>
);

// ─── Main App ─────────────────────────────────────────────────────────────────

function App() {
  const [isLogin, setIsLogin] = useState(true);
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState("Intern");
  const [activePage, setActivePage] = useState("Dashboard");

  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedRole, setSelectedRole] = useState("Intern");

  const [taskTitle, setTaskTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [taskNotes, setTaskNotes] = useState("");

  const [clientForm, setClientForm] = useState({
    name: "",
    contactPerson: "",
    email: "",
    phone: "",
    service: "Monthly Accounting",
  });

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedTask, setSelectedTask] = useState(null);
  const [commentText, setCommentText] = useState("");
  const [uploadingTaskId, setUploadingTaskId] = useState("");

  const canManageTasks = userRole === "Boss" || userRole === "Supervisor";
  const canDeleteTasks = userRole === "Boss";
  const canManageUsers = userRole === "Boss";
  const canSeeReports = userRole === "Boss" || userRole === "Supervisor";
  const canManageClients = userRole === "Boss" || userRole === "Supervisor";

  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const userRef = doc(db, "users", currentUser.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          setUserRole(userSnap.data().role || "Intern");
        } else {
          await setDoc(userRef, {
            email: currentUser.email,
            role: "Intern",
            createdAt: serverTimestamp(),
          });
          setUserRole("Intern");
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Firestore listeners
  useEffect(() => {
    if (!user) return;

    const unsubTasks = onSnapshot(
      query(collection(db, "tasks"), orderBy("createdAt", "desc")),
      (snap) => setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
    const unsubUsers = onSnapshot(
      query(collection(db, "users"), orderBy("email", "asc")),
      (snap) => setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
    const unsubClients = onSnapshot(
      query(collection(db, "clients"), orderBy("name", "asc")),
      (snap) => setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );

    return () => { unsubTasks(); unsubUsers(); unsubClients(); };
  }, [user]);

  // Derived task lists
  const visibleTasks = useMemo(() => {
    let list = tasks;

    if (userRole === "Intern" && user?.email) {
      list = list.filter(
        (t) =>
          (t.assignedTo || "").toLowerCase() === user.email.toLowerCase() ||
          (t.createdBy || "").toLowerCase() === user.email.toLowerCase()
      );
    }
    if (statusFilter !== "All") {
      list = list.filter((t) => (t.status || "Pending") === statusFilter);
    }
    if (searchTerm.trim()) {
      const s = searchTerm.toLowerCase();
      list = list.filter((t) =>
        [t.title, t.clientName, t.assignedTo, t.priority, t.status, t.notes]
          .join(" ").toLowerCase().includes(s)
      );
    }
    return list;
  }, [tasks, userRole, user, statusFilter, searchTerm]);

  const pendingTasks   = visibleTasks.filter((t) => t.status === "Pending").length;
  const progressTasks  = visibleTasks.filter((t) => t.status === "In Progress").length;
  const completedTasks = visibleTasks.filter((t) => t.status === "Completed").length;
  const overdueTasks   = visibleTasks.filter((t) => {
    if (!t.deadline || t.status === "Completed") return false;
    return new Date(t.deadline + "T23:59:59") < new Date();
  }).length;

  const interns     = users.filter((m) => m.role === "Intern");
  const supervisors = users.filter((m) => m.role === "Supervisor");

  // Handlers
  const handleAuth = async (e) => {
    e.preventDefault();
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const created = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(db, "users", created.user.uid), {
          email, role: selectedRole, createdAt: serverTimestamp(),
        });
      }
      setEmail(""); setPassword(""); setSelectedRole("Intern");
    } catch (error) { alert(error.message); }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setActivePage("Dashboard");
    setUserRole("Intern");
  };

  const addTask = async (e) => {
    e.preventDefault();
    if (!canManageTasks) { alert("Only a Boss or Supervisor can create tasks."); return; }
    if (!taskTitle || !clientName || !assignedTo || !deadline) {
      alert("Please fill in task title, client, assigned person, and deadline."); return;
    }
    try {
      await addDoc(collection(db, "tasks"), {
        title: taskTitle, clientName, assignedTo, deadline, priority,
        notes: taskNotes, status: "Pending",
        createdBy: user.email, createdByRole: userRole,
        files: [], comments: [],
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      setTaskTitle(""); setClientName(""); setAssignedTo("");
      setDeadline(""); setPriority("Medium"); setTaskNotes("");
      setActivePage("Tasks");
    } catch (error) { alert(error.message); }
  };

  const updateTaskStatus = async (taskId, newStatus) => {
    try {
      await updateDoc(doc(db, "tasks", taskId), {
        status: newStatus, updatedAt: serverTimestamp(), updatedBy: user.email,
      });
    } catch (error) { alert(error.message); }
  };

  const deleteTask = async (taskId) => {
    if (!canDeleteTasks) { alert("Only the Boss can delete tasks."); return; }
    if (!window.confirm("Are you sure you want to delete this task?")) return;
    try {
      await deleteDoc(doc(db, "tasks", taskId));
      if (selectedTask?.id === taskId) setSelectedTask(null);
    } catch (error) { alert(error.message); }
  };

  const changeUserRole = async (memberId, newRole) => {
    if (!canManageUsers) { alert("Only the Boss can change user roles."); return; }
    try {
      await updateDoc(doc(db, "users", memberId), {
        role: newRole, updatedAt: serverTimestamp(), updatedBy: user.email,
      });
    } catch (error) { alert(error.message); }
  };

  const addClient = async (e) => {
    e.preventDefault();
    if (!canManageClients) { alert("Only a Boss or Supervisor can add clients."); return; }
    if (!clientForm.name) { alert("Please enter a client name."); return; }
    try {
      await addDoc(collection(db, "clients"), {
        ...clientForm, createdBy: user.email, createdAt: serverTimestamp(),
      });
      setClientForm({ name: "", contactPerson: "", email: "", phone: "", service: "Monthly Accounting" });
    } catch (error) { alert(error.message); }
  };

  const deleteClient = async (clientId) => {
    if (!canDeleteTasks) { alert("Only the Boss can delete clients."); return; }
    if (!window.confirm("Delete this client?")) return;
    try { await deleteDoc(doc(db, "clients", clientId)); }
    catch (error) { alert(error.message); }
  };

  const addComment = async (task) => {
    if (!commentText.trim()) return;
    const liveTask = tasks.find((t) => t.id === task.id) || task;
    const newComment = {
      text: commentText, author: user.email, role: userRole,
      createdAt: new Date().toISOString(),
    };
    try {
      await updateDoc(doc(db, "tasks", task.id), {
        comments: [...(liveTask.comments || []), newComment],
        updatedAt: serverTimestamp(),
      });
      setCommentText(""); // onSnapshot refreshes modal automatically
    } catch (error) { alert(error.message); }
  };

  const uploadFileToTask = async (task, file, inputRef) => {
    if (!file) return;
    try {
      setUploadingTaskId(task.id);
      const safeFileName = file.name.replaceAll(" ", "_");
      const fileRef = ref(storage, `task-files/${task.id}/${Date.now()}-${safeFileName}`);

      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);

      // Use live task to avoid stale files array
      const liveTask = tasks.find((t) => t.id === task.id) || task;
      const newFile = {
        name: file.name, url,
        uploadedBy: user.email, uploadedAt: new Date().toISOString(),
      };

      await updateDoc(doc(db, "tasks", task.id), {
        files: [...(liveTask.files || []), newFile],
        updatedAt: serverTimestamp(),
      });

      if (inputRef?.current) inputRef.current.value = "";
      setUploadingTaskId("");
    } catch (error) {
      setUploadingTaskId("");
      alert("Upload failed: " + error.message);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (user) {
    return (
      <div className="app-layout">
        <aside className="sidebar">
          <div className="brand">
            <img src={logo} alt="ProgressPoint Logo" />
          </div>
          <nav className="nav-menu">
            <NavButton page="Dashboard" activePage={activePage} setActivePage={setActivePage} />
            <NavButton page="Tasks"     activePage={activePage} setActivePage={setActivePage} />
            <NavButton page="Interns"   activePage={activePage} setActivePage={setActivePage} />
            <NavButton page="Supervisors" activePage={activePage} setActivePage={setActivePage} />
            <NavButton page="Clients"   activePage={activePage} setActivePage={setActivePage} />
            {canManageUsers && <NavButton page="Admin" activePage={activePage} setActivePage={setActivePage} />}
            <NavButton page="Reports"   activePage={activePage} setActivePage={setActivePage} />
          </nav>
          <button className="logout-btn" onClick={handleLogout}>Logout</button>
        </aside>

        <main className="main-content">
          <header className="topbar">
            <div>
              <h1>{activePage}</h1>
              <p>Track, assign, and monitor accounting firm work in one place.</p>
            </div>
            <div className="topbar-right">
              <div className="overdue-pill">{overdueTasks} overdue</div>
              <div className="user-pill">{userRole}</div>
              <div className="user-pill">{user.email}</div>
            </div>
          </header>

          {activePage === "Dashboard" && (
            <DashboardPage
              visibleTasks={visibleTasks} pendingTasks={pendingTasks}
              progressTasks={progressTasks} completedTasks={completedTasks}
              canManageTasks={canManageTasks} canDeleteTasks={canDeleteTasks}
              taskTitle={taskTitle} setTaskTitle={setTaskTitle}
              clientName={clientName} setClientName={setClientName}
              clients={clients} users={users}
              assignedTo={assignedTo} setAssignedTo={setAssignedTo}
              deadline={deadline} setDeadline={setDeadline}
              priority={priority} setPriority={setPriority}
              taskNotes={taskNotes} setTaskNotes={setTaskNotes}
              addTask={addTask} userRole={userRole}
              searchTerm={searchTerm} setSearchTerm={setSearchTerm}
              statusFilter={statusFilter} setStatusFilter={setStatusFilter}
              updateTaskStatus={updateTaskStatus} deleteTask={deleteTask}
              setSelectedTask={setSelectedTask} setActivePage={setActivePage}
            />
          )}
          {activePage === "Tasks" && (
            <TasksPage
              visibleTasks={visibleTasks} canManageTasks={canManageTasks} canDeleteTasks={canDeleteTasks}
              searchTerm={searchTerm} setSearchTerm={setSearchTerm}
              statusFilter={statusFilter} setStatusFilter={setStatusFilter}
              updateTaskStatus={updateTaskStatus} deleteTask={deleteTask}
              setSelectedTask={setSelectedTask} setActivePage={setActivePage}
            />
          )}
          {activePage === "Interns"     && <InternsPage interns={interns} tasks={tasks} />}
          {activePage === "Supervisors" && <SupervisorsPage supervisors={supervisors} />}
          {activePage === "Clients"     && (
            <ClientsPage
              clients={clients} clientForm={clientForm} setClientForm={setClientForm}
              canManageClients={canManageClients} canDeleteTasks={canDeleteTasks}
              addClient={addClient} deleteClient={deleteClient}
            />
          )}
          {activePage === "Admin"   && <AdminPage canManageUsers={canManageUsers} users={users} changeUserRole={changeUserRole} />}
          {activePage === "Reports" && (
            <ReportsPage
              canSeeReports={canSeeReports} overdueTasks={overdueTasks}
              completedTasks={completedTasks} pendingTasks={pendingTasks}
              progressTasks={progressTasks} visibleTasks={visibleTasks}
            />
          )}
        </main>

        <TaskModal
          selectedTask={selectedTask} setSelectedTask={setSelectedTask}
          tasks={tasks} uploadFileToTask={uploadFileToTask}
          uploadingTaskId={uploadingTaskId}
          commentText={commentText} setCommentText={setCommentText}
          addComment={addComment}
        />
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="auth-box" onSubmit={handleAuth}>
        <img src={logo} alt="ProgressPoint Logo" className="auth-logo" />

        <h1>{isLogin ? "Welcome Back" : "Create Account"}</h1>
        <p>
          {isLogin ? "Login to manage accounting tasks." : "Create an account for ProgressPoint."}
        </p>

        <input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {!isLogin && (
          <select
            className="auth-select"
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value)}
          >
            <option value="Intern">Intern</option>
            <option value="Supervisor">Supervisor</option>
            <option value="Boss">Boss</option>
          </select>
        )}

        <button type="submit">{isLogin ? "Login" : "Create Account"}</button>

        <span onClick={() => setIsLogin(!isLogin)}>
          {isLogin ? "Create an account" : "Already have an account? Login"}
        </span>
      </form>
    </div>
  );
}

export default App;
